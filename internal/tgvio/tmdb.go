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
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"golang.org/x/time/rate"
)

// Posters from TMDB for folders and videos named after films and series.
//
// A name is cleaned ("[周星驰] 大话西游 (1995) [tt0112778][20.27GB].iso" becomes
// an IMDb lookup; "Chainsaw.Man.Reze.Arc.2025.2160p.WEB-DL" becomes the query
// "Chainsaw Man Reze Arc", 2025), looked up once in the background and kept in
// <data>/tgvio/posters.json; images are fetched once into <data>/tgvio/posters/.
// Nothing here talks to the drive. The read token lives in <data>/tgvio/tmdb_token
// (or TGVIO_TMDB_TOKEN) and never leaves the server.

// Poster is what the front end gets for one name.
type Poster struct {
	Kind     string  `json:"kind"` // "movie" or "tv"
	ID       int     `json:"id"`
	Title    string  `json:"title"`
	Original string  `json:"original,omitempty"`
	Year     int     `json:"year,omitempty"`
	Poster   string  `json:"poster,omitempty"`   // TMDB file name, e.g. "/abc.jpg"
	Backdrop string  `json:"backdrop,omitempty"` // TMDB file name
	Overview string  `json:"overview,omitempty"`
	Rating   float64 `json:"rating,omitempty"`
	Manual   bool    `json:"manual,omitempty"`
	None     bool    `json:"none,omitempty"` // looked up, nothing fits (or the user said no poster)
	At       int64   `json:"at"`
}

// ---------------------------------------------------------------- names

var (
	tmdbTag     = regexp.MustCompile(`(?i)[{\[(]?\btmdb(?:id)?[-=_: ]?(\d{2,9})\b[}\])]?`)
	imdbTag     = regexp.MustCompile(`\btt(\d{6,9})\b`)
	yearTag     = regexp.MustCompile(`(?:^|[\s.\-_(\[（【])((?:19|20)\d{2})(?:$|[\s.\-_)\]）】])`)
	brackets    = regexp.MustCompile(`[\[【{][^\]】}]*[\]】}]`)
	parens      = regexp.MustCompile(`[(（][^)）]*[)）]`)
	extension   = regexp.MustCompile(`(?i)\.(mp4|mkv|avi|mov|wmv|flv|ts|m2ts|rmvb|webm|iso|m4v)$`)
	releaseJunk = regexp.MustCompile(`(?i)\b(2160p|1080p|720p|480p|4k|uhd|hdr10?\+?|hdr|dv|dolby ?vision|web-?dl|web-?rip|webrip|blu-?ray|bdrip|remux|x26[45]|h\.?26[45]|hevc|avc|aac|ddp?\d?\.?\d?|atmos|truehd|dts(-hd)?|10bit|ma|hmax|nf|amzn|dsnp|repack|proper|complete|s\d{1,2}(e\d{1,3})?|第.{1,3}[季集部])\b`)
	cjkJunk     = regexp.MustCompile(`(国粤语|国语|粤语|中字|中英字幕|简繁|双语|原盘|全集|合集|特效字幕|蓝光|高清|超清|完结|更新至.*|全\d+集)`)
	spaces      = regexp.MustCompile(`\s+`)
)

// CleanName reads a file or folder name for what a film database can search.
func CleanName(name string) (query string, year int, tmdbID int, imdbID string) {
	name = extension.ReplaceAllString(strings.TrimSpace(name), "")
	if m := tmdbTag.FindStringSubmatch(name); m != nil {
		tmdbID, _ = strconv.Atoi(m[1])
		name = strings.Replace(name, m[0], " ", 1)
	}
	if m := imdbTag.FindStringSubmatch(name); m != nil {
		imdbID = "tt" + m[1]
	}
	if m := yearTag.FindStringSubmatch(name); m != nil {
		year, _ = strconv.Atoi(m[1])
	}
	cut := brackets.ReplaceAllString(name, " ")
	cut = parens.ReplaceAllString(cut, " ")
	if strings.Count(cut, ".") >= 2 && !strings.Contains(cut, " ") {
		cut = strings.ReplaceAll(cut, ".", " ") // Release.Name.2025.2160p
	}
	cut = strings.NewReplacer("_", " ", "·", " ", "：", " ", ":", " ").Replace(cut)
	// A scene-style name stops at its year: what follows is release detail.
	if year > 0 {
		if i := strings.Index(cut, strconv.Itoa(year)); i > 0 {
			cut = cut[:i]
		}
	}
	cut = releaseJunk.ReplaceAllString(cut, " ")
	cut = cjkJunk.ReplaceAllString(cut, " ")
	cut = strings.Trim(spaces.ReplaceAllString(cut, " "), " .-_")
	// Episode files ("01", "E05") and bare numbers name nothing.
	if strings.IndexFunc(cut, func(r rune) bool { return unicode.IsLetter(r) }) < 0 {
		cut = ""
	}
	return cut, year, tmdbID, imdbID
}

// Key is how a name is stored: case and spacing do not make a new entry.
func Key(name string) string {
	return strings.ToLower(spaces.ReplaceAllString(strings.TrimSpace(name), " "))
}

func normalizeTitle(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// ---------------------------------------------------------------- client

type TMDB struct {
	dir     string
	token   string
	http    *http.Client
	limiter *rate.Limiter

	mu      sync.Mutex
	entries map[string]*Poster
	saveAt  *time.Timer
	queue   chan string
	queued  map[string]bool
}

var (
	tmdbOnce     sync.Once
	tmdbInstance *TMDB
)

// Posters returns the process-wide poster service rooted in the data directory.
func Posters(dataDir string) *TMDB {
	tmdbOnce.Do(func() {
		dir := filepath.Join(dataDir, "tgvio")
		token := strings.TrimSpace(os.Getenv("TGVIO_TMDB_TOKEN"))
		if token == "" {
			if raw, err := os.ReadFile(filepath.Join(dir, "tmdb_token")); err == nil {
				token = strings.TrimSpace(string(raw))
			}
		}
		t := &TMDB{
			dir:     dir,
			token:   token,
			http:    &http.Client{Timeout: 20 * time.Second},
			limiter: rate.NewLimiter(4, 4),
			entries: map[string]*Poster{},
			queue:   make(chan string, 4096),
			queued:  map[string]bool{},
		}
		if raw, err := os.ReadFile(filepath.Join(dir, "posters.json")); err == nil {
			_ = json.Unmarshal(raw, &t.entries)
		}
		go t.work()
		tmdbInstance = t
	})
	return tmdbInstance
}

func (t *TMDB) Enabled() bool { return t.token != "" }

func (t *TMDB) get(ctx context.Context, path string, query url.Values, out any) error {
	return t.getIn(ctx, "zh-CN", path, query, out)
}

func (t *TMDB) getIn(ctx context.Context, language, path string, query url.Values, out any) error {
	if err := t.limiter.Wait(ctx); err != nil {
		return err
	}
	if query == nil {
		query = url.Values{}
	}
	query.Set("language", language)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.themoviedb.org/3/"+path+"?"+query.Encode(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+t.token)
	req.Header.Set("Accept", "application/json")
	Inc("tmdb_api")
	resp, err := t.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return errNotFound
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("tmdb: HTTP %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

var errNotFound = errors.New("not found")

type tmdbItem struct {
	MediaType     string  `json:"media_type"`
	ID            int     `json:"id"`
	Title         string  `json:"title"`
	Name          string  `json:"name"`
	OriginalTitle string  `json:"original_title"`
	OriginalName  string  `json:"original_name"`
	ReleaseDate   string  `json:"release_date"`
	FirstAirDate  string  `json:"first_air_date"`
	PosterPath    string  `json:"poster_path"`
	BackdropPath  string  `json:"backdrop_path"`
	Overview      string  `json:"overview"`
	VoteAverage   float64 `json:"vote_average"`
	Popularity    float64 `json:"popularity"`
}

func (i tmdbItem) poster(kind string) *Poster {
	if kind == "" {
		kind = i.MediaType
	}
	title, original, date := i.Title, i.OriginalTitle, i.ReleaseDate
	if kind == "tv" {
		title, original, date = i.Name, i.OriginalName, i.FirstAirDate
	}
	year := 0
	if len(date) >= 4 {
		year, _ = strconv.Atoi(date[:4])
	}
	if original == title {
		original = ""
	}
	return &Poster{Kind: kind, ID: i.ID, Title: title, Original: original, Year: year, Poster: i.PosterPath,
		Backdrop: i.BackdropPath, Overview: i.Overview, Rating: i.VoteAverage, At: time.Now().Unix()}
}

type searchResult struct {
	Results []tmdbItem `json:"results"`
}

// Search asks TMDB for films and series matching a query, best first.
func (t *TMDB) Search(ctx context.Context, query string, year int) ([]*Poster, error) {
	if !t.Enabled() {
		return nil, errors.New("TMDB is not configured")
	}
	var items []tmdbItem
	if year > 0 {
		for _, kind := range []string{"tv", "movie"} {
			var r searchResult
			q := url.Values{"query": {query}, "include_adult": {"false"}}
			if kind == "tv" {
				q.Set("first_air_date_year", strconv.Itoa(year))
			} else {
				q.Set("year", strconv.Itoa(year))
			}
			if err := t.get(ctx, "search/"+kind, q, &r); err != nil {
				return nil, err
			}
			for _, item := range r.Results {
				item.MediaType = kind
				items = append(items, item)
			}
		}
	}
	if len(items) == 0 {
		var r searchResult
		if err := t.get(ctx, "search/multi", url.Values{"query": {query}, "include_adult": {"false"}}, &r); err != nil {
			return nil, err
		}
		items = r.Results
	}
	want := normalizeTitle(query)
	type scored struct {
		p     *Poster
		score float64
	}
	var ranked []scored
	for _, item := range items {
		if item.MediaType != "movie" && item.MediaType != "tv" {
			continue
		}
		p := item.poster("")
		score := item.Popularity / 100
		for _, title := range []string{p.Title, p.Original, item.Title, item.Name} {
			got := normalizeTitle(title)
			switch {
			case got == "" || want == "":
			case got == want:
				score += 100
			case strings.Contains(got, want) || strings.Contains(want, got):
				score += 40
			}
		}
		if year > 0 && p.Year == year {
			score += 30
		}
		if p.Poster == "" {
			score -= 50
		}
		ranked = append(ranked, scored{p, score})
	}
	sort.SliceStable(ranked, func(i, j int) bool { return ranked[i].score > ranked[j].score })
	out := make([]*Poster, 0, len(ranked))
	for _, r := range ranked {
		out = append(out, r.p)
	}
	return out, nil
}

// Details reads one film or series by its TMDB id.
func (t *TMDB) Details(ctx context.Context, kind string, id int) (*Poster, error) {
	var item tmdbItem
	if err := t.get(ctx, kind+"/"+strconv.Itoa(id), nil, &item); err != nil {
		return nil, err
	}
	return item.poster(kind), nil
}

// lookup finds the best poster for a name, or a "none" entry.
func (t *TMDB) lookup(ctx context.Context, name string) (*Poster, error) {
	query, year, tmdbID, imdbID := CleanName(name)
	none := &Poster{None: true, At: time.Now().Unix()}
	if imdbID != "" {
		var r struct {
			Movies []tmdbItem `json:"movie_results"`
			Shows  []tmdbItem `json:"tv_results"`
		}
		if err := t.get(ctx, "find/"+imdbID, url.Values{"external_source": {"imdb_id"}}, &r); err == nil {
			if len(r.Movies) > 0 {
				return r.Movies[0].poster("movie"), nil
			}
			if len(r.Shows) > 0 {
				return r.Shows[0].poster("tv"), nil
			}
		}
	}
	if tmdbID > 0 {
		var candidates []*Poster
		for _, kind := range []string{"movie", "tv"} {
			if p, err := t.Details(ctx, kind, tmdbID); err == nil {
				candidates = append(candidates, p)
			} else if !errors.Is(err, errNotFound) {
				return nil, err
			}
		}
		// The same id exists as both a film and a series: the title decides.
		want := normalizeTitle(query)
		for _, p := range candidates {
			if want != "" && (strings.Contains(normalizeTitle(p.Title), want) || strings.Contains(normalizeTitle(p.Original), want)) {
				return p, nil
			}
		}
		if len(candidates) > 0 {
			return candidates[0], nil
		}
	}
	if query == "" {
		return none, nil
	}
	results, err := t.Search(ctx, query, year)
	if err != nil {
		return nil, err
	}
	if len(results) == 0 || results[0].Poster == "" {
		return none, nil
	}
	best := results[0]
	// Require some agreement between the name and the title found.
	if agrees(query, best.Title, best.Original) {
		return best, nil
	}
	// An English release name against Chinese and Japanese titles: compare with
	// the English title of the same entry instead.
	if isLatin(query) {
		var english tmdbItem
		if err := t.getIn(ctx, "en-US", best.Kind+"/"+strconv.Itoa(best.ID), nil, &english); err == nil {
			if agrees(query, english.Title, english.Name) {
				return best, nil
			}
		}
	}
	return none, nil
}

func agrees(query string, titles ...string) bool {
	want := normalizeTitle(query)
	if want == "" {
		return false
	}
	for _, title := range titles {
		got := normalizeTitle(title)
		if got != "" && (strings.Contains(got, want) || strings.Contains(want, got)) {
			return true
		}
	}
	return false
}

func isLatin(s string) bool {
	for _, r := range s {
		if r > unicode.MaxLatin1 {
			return false
		}
	}
	return true
}

// ---------------------------------------------------------------- store

// Lookup answers from the store; unknown names are queued for the background worker.
func (t *TMDB) Lookup(names []string) (map[string]*Poster, int) {
	out := make(map[string]*Poster, len(names))
	pending := 0
	t.mu.Lock()
	defer t.mu.Unlock()
	now := time.Now().Unix()
	for _, name := range names {
		key := Key(name)
		entry, ok := t.entries[key]
		// "Nothing found" is retried after a week: TMDB keeps growing.
		if ok && (!entry.None || entry.Manual || now-entry.At < 7*24*3600) {
			out[name] = entry
			continue
		}
		if !t.Enabled() {
			continue
		}
		pending++
		if !t.queued[key] {
			select {
			case t.queue <- name:
				t.queued[key] = true
			default:
			}
		}
	}
	return out, pending
}

// Set stores a choice made by a person; it wins over any lookup.
func (t *TMDB) Set(name string, p *Poster) {
	p.Manual = true
	p.At = time.Now().Unix()
	t.mu.Lock()
	t.entries[Key(name)] = p
	t.mu.Unlock()
	t.save()
}

func (t *TMDB) work() {
	for name := range t.queue {
		key := Key(name)
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		p, err := t.lookup(ctx, name)
		cancel()
		t.mu.Lock()
		delete(t.queued, key)
		if err == nil {
			t.entries[key] = p
		}
		t.mu.Unlock()
		if err == nil {
			Inc("tmdb_lookup")
			t.save()
		} else {
			Inc("tmdb_lookup_error")
			time.Sleep(5 * time.Second) // TMDB or the network is unhappy: slow down
		}
	}
}

func (t *TMDB) save() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.saveAt != nil {
		t.saveAt.Stop()
	}
	t.saveAt = time.AfterFunc(2*time.Second, func() {
		t.mu.Lock()
		raw, err := json.Marshal(t.entries)
		t.mu.Unlock()
		if err != nil {
			return
		}
		_ = os.MkdirAll(t.dir, 0o700)
		tmp := filepath.Join(t.dir, "posters.json.tmp")
		if os.WriteFile(tmp, raw, 0o600) == nil {
			_ = os.Rename(tmp, filepath.Join(t.dir, "posters.json"))
		}
	})
}

// ---------------------------------------------------------------- images

var (
	imageName  = regexp.MustCompile(`^[A-Za-z0-9_-]{6,64}\.(jpg|png)$`)
	imageSizes = map[string]bool{"w185": true, "w342": true, "w500": true, "w780": true, "w1280": true}
	imageLocks sync.Map
)

// Image returns a local copy of a TMDB image, fetching it the first time.
func (t *TMDB) Image(ctx context.Context, size, file string) (string, error) {
	if !imageSizes[size] || !imageName.MatchString(file) {
		return "", errNotFound
	}
	path := filepath.Join(t.dir, "posters", size, file)
	if _, err := os.Stat(path); err == nil {
		return path, nil
	}
	lock, _ := imageLocks.LoadOrStore(size+"/"+file, &sync.Mutex{})
	lock.(*sync.Mutex).Lock()
	defer lock.(*sync.Mutex).Unlock()
	if _, err := os.Stat(path); err == nil {
		return path, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://image.tmdb.org/t/p/"+size+"/"+file, nil)
	if err != nil {
		return "", err
	}
	Inc("tmdb_image")
	resp, err := t.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("tmdb image: HTTP %d", resp.StatusCode)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return "", err
	}
	tmp := path + ".tmp"
	out, err := os.Create(tmp)
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(out, io.LimitReader(resp.Body, 8<<20)); err != nil {
		out.Close()
		os.Remove(tmp)
		return "", err
	}
	out.Close()
	return path, os.Rename(tmp, path)
}
