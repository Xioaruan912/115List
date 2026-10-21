package tgvio

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Resource search: the library looks a title up on resource sites (seedhub
// first). The server never scrapes them: many sit behind Cloudflare checks a
// server cannot pass, and a person's own browser can. So a site here is a
// search address the browser opens; the person copies the magnets there and
// pastes them back, and the library sorts, picks a folder and downloads.
//
// A Provider is the seam for sites that can be read from the server one day
// (an API, a feed): it only has to say where its search page is and whether it
// answers. TemplateSite is the one kind there is today.

// Provider is one resource site.
type Provider interface {
	SearchURL(query string) string
	Probe(ctx context.Context, client *http.Client) ProbeResult
}

// ResourceSite is a site the admin configured: its search address with {q}
// where the keywords go.
type ResourceSite struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Search  string `json:"search"`
	Enabled bool   `json:"enabled"`
	// Reader: how the server reads the site itself ("seedhub"); empty: it only opens in the browser.
	Reader string `json:"reader,omitempty"`
}

// ResourceConfig is the whole feature: on or off, and its sites in order.
type ResourceConfig struct {
	Enabled bool           `json:"enabled"`
	Sites   []ResourceSite `json:"sites"`
	// Folder: where downloads go by default, each title in its own folder inside ("/115/我要看").
	Folder string `json:"folder,omitempty"`
}

// ProbeResult says how a site answered the server.
//
//	ok         answered normally
//	challenge  answered with a bot check (Cloudflare): fine in a browser, not for the server
//	down       did not answer, or answered with an error
type ProbeResult struct {
	ID      string `json:"id"`
	State   string `json:"state"`
	Status  int    `json:"status,omitempty"`
	Millis  int64  `json:"ms"`
	Message string `json:"message,omitempty"`
}

// TemplateSite is a site whose search page is its address with the keywords in it.
type TemplateSite struct{ ResourceSite }

func (s TemplateSite) SearchURL(query string) string {
	return strings.ReplaceAll(s.Search, "{q}", url.PathEscape(strings.TrimSpace(query)))
}

// Probe asks for the site's front page.
func (s TemplateSite) Probe(ctx context.Context, client *http.Client) ProbeResult {
	out := ProbeResult{ID: s.ID}
	target, err := url.Parse(s.Search)
	if err != nil || target.Host == "" {
		out.State, out.Message = "down", "invalid address"
		return out
	}
	home := target.Scheme + "://" + target.Host + "/"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, home, nil)
	if err != nil {
		out.State, out.Message = "down", err.Error()
		return out
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36")
	req.Header.Set("Accept", "text/html")
	start := time.Now()
	resp, err := client.Do(req)
	out.Millis = time.Since(start).Milliseconds()
	if err != nil {
		out.State, out.Message = "down", shortError(err)
		return out
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	out.Status = resp.StatusCode
	switch {
	case isChallenge(resp, body):
		out.State = "challenge"
	case resp.StatusCode < 400:
		out.State = "ok"
	default:
		out.State, out.Message = "down", fmt.Sprintf("HTTP %d", resp.StatusCode)
	}
	return out
}

// isChallenge: a Cloudflare human check instead of the page. (Normal pages
// carry Cloudflare's challenge-platform script too, so that alone says nothing.)
func isChallenge(resp *http.Response, body []byte) bool {
	if resp.Header.Get("cf-mitigated") == "challenge" {
		return true
	}
	return (resp.StatusCode == 403 || resp.StatusCode == 503) && (strings.Contains(string(body), "Just a moment") || strings.Contains(string(body), "challenge-platform"))
}

func shortError(err error) string {
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		err = urlErr.Err
	}
	if errors.Is(err, context.DeadlineExceeded) || strings.Contains(err.Error(), "Client.Timeout") {
		return "timeout"
	}
	return err.Error()
}

// DefaultResources: off, with seedhub ready to switch on.
func DefaultResources() ResourceConfig {
	return ResourceConfig{Sites: []ResourceSite{{ID: "seedhub", Name: "SeedHub", Search: "https://www.seedhub.cc/s/{q}/", Enabled: true}}}
}

// Resources keeps the configuration in data/tgvio/resources.json.
type Resources struct {
	path string
	mu   sync.Mutex
	cfg  ResourceConfig
	http *http.Client
}

var (
	resourcesOnce     sync.Once
	resourcesInstance *Resources
)

// ResourceSites returns the process-wide configuration rooted in the data directory.
func ResourceSites(dataDir string) *Resources {
	resourcesOnce.Do(func() {
		r := &Resources{path: filepath.Join(dataDir, "tgvio", "resources.json"), cfg: DefaultResources(), http: &http.Client{Timeout: 10 * time.Second}}
		if raw, err := os.ReadFile(r.path); err == nil {
			var cfg ResourceConfig
			if json.Unmarshal(raw, &cfg) == nil {
				r.cfg = cfg
			}
		}
		resourcesInstance = r
	})
	return resourcesInstance
}

func (r *Resources) Config() ResourceConfig {
	r.mu.Lock()
	defer r.mu.Unlock()
	cfg := r.cfg
	cfg.Sites = append([]ResourceSite(nil), r.cfg.Sites...)
	return cfg
}

// Save checks and stores a configuration: every site needs a name and an
// http(s) address with {q}; IDs are made unique.
func (r *Resources) Save(cfg ResourceConfig) (ResourceConfig, error) {
	seen := map[string]bool{}
	sites := make([]ResourceSite, 0, len(cfg.Sites))
	for i, site := range cfg.Sites {
		site.Name = strings.TrimSpace(site.Name)
		site.Search = strings.TrimSpace(site.Search)
		if site.Reader != "" && site.Reader != "seedhub" {
			return cfg, fmt.Errorf("%s: unknown reader %q", site.Name, site.Reader)
		}
		if site.Name == "" {
			return cfg, fmt.Errorf("site %d has no name", i+1)
		}
		u, err := url.Parse(strings.ReplaceAll(site.Search, "{q}", "q"))
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || !strings.Contains(site.Search, "{q}") {
			return cfg, fmt.Errorf("%s: the search address must start with http(s):// and contain {q}", site.Name)
		}
		id := slug(site.ID)
		if id == "" {
			id = slug(u.Hostname())
		}
		for base, n := id, 2; seen[id]; n++ {
			id = fmt.Sprintf("%s-%d", base, n)
		}
		seen[id] = true
		site.ID = id
		sites = append(sites, site)
	}
	cfg.Sites = sites
	if folder := strings.TrimSpace(cfg.Folder); folder != "" {
		if !strings.HasPrefix(folder, "/") {
			return cfg, fmt.Errorf("the default folder must be a path starting with /")
		}
		cfg.Folder = path.Clean(folder)
	}
	raw, _ := json.MarshalIndent(cfg, "", "  ")
	if err := os.MkdirAll(filepath.Dir(r.path), 0o700); err != nil {
		return cfg, err
	}
	if err := os.WriteFile(r.path, raw, 0o600); err != nil {
		return cfg, err
	}
	r.mu.Lock()
	r.cfg = cfg
	r.mu.Unlock()
	return cfg, nil
}

// Providers are the enabled sites, in order.
func (r *Resources) Providers() []TemplateSite {
	var out []TemplateSite
	for _, site := range r.Config().Sites {
		if site.Enabled {
			out = append(out, TemplateSite{site})
		}
	}
	return out
}

// ReaderFor is the server-side reader of an enabled site.
func (r *Resources) ReaderFor(id string) (Reader, error) {
	cfg := r.Config()
	if !cfg.Enabled {
		return nil, fmt.Errorf("resource search is off")
	}
	for _, site := range cfg.Sites {
		if site.ID == id && site.Enabled {
			if site.Reader == "seedhub" {
				return SeedHubReader(site.Search, r.http)
			}
			return nil, fmt.Errorf("%s opens in the browser only", site.Name)
		}
	}
	return nil, fmt.Errorf("no such site")
}

// ProbeAll asks every configured site at once.
func (r *Resources) ProbeAll(ctx context.Context) []ProbeResult {
	sites := r.Config().Sites
	out := make([]ProbeResult, len(sites))
	var wg sync.WaitGroup
	for i, site := range sites {
		wg.Add(1)
		go func(i int, p Provider) {
			defer wg.Done()
			out[i] = p.Probe(ctx, r.http)
		}(i, TemplateSite{site})
	}
	wg.Wait()
	return out
}

func slug(s string) string {
	var b strings.Builder
	for _, c := range strings.ToLower(s) {
		switch {
		case c >= 'a' && c <= 'z', c >= '0' && c <= '9':
			b.WriteRune(c)
		case c == '.' || c == '-' || c == '_' || c == ' ':
			if b.Len() > 0 && !strings.HasSuffix(b.String(), "-") {
				b.WriteByte('-')
			}
		}
	}
	return strings.Trim(strings.TrimPrefix(b.String(), "www-"), "-")
}
