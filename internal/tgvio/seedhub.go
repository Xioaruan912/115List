package tgvio

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/PuerkitoBio/goquery"
	"golang.org/x/time/rate"
)

// SeedHub, read by the server: its search page lists titles, a title's page
// lists its releases ("seeds": name, size, tags), and each seed's page holds
// its magnet. Only the seeds someone downloads are opened for their magnet.
// The site's address comes from the configured search address, so a new
// domain is a settings change.

// Reader is a site the server can read itself, beyond opening its search page.
type Reader interface {
	Titles(ctx context.Context, query string) ([]ResourceTitle, error)
	Seeds(ctx context.Context, id string) ([]ResourceSeed, error)
	Magnet(ctx context.Context, seed string) (string, error)
}

// ResourceTitle is a film or series on a site.
type ResourceTitle struct {
	ID     string  `json:"id"`
	Title  string  `json:"title"`
	Year   int     `json:"year,omitempty"`
	Kind   string  `json:"kind,omitempty"` // 电影, 剧集, 动漫 as the site says
	Info   string  `json:"info,omitempty"`
	Image  string  `json:"image,omitempty"`
	Rating float64 `json:"rating,omitempty"`
	URL    string  `json:"url"`
}

// ResourceSeed is one release of a title.
type ResourceSeed struct {
	ID       string   `json:"id"`
	Title    string   `json:"title"`
	Size     string   `json:"size,omitempty"`
	Features []string `json:"features,omitempty"`
	Date     string   `json:"date,omitempty"`
}

type seedHub struct {
	origin string
	client *http.Client
}

var (
	seedHubLimit = rate.NewLimiter(rate.Every(400*time.Millisecond), 4)
	seedHubCache sync.Map // url -> cachedPage
)

type cachedPage struct {
	body []byte
	at   time.Time
}

// SeedHubReader reads the SeedHub at the origin of a search address.
func SeedHubReader(search string, client *http.Client) (Reader, error) {
	u, err := url.Parse(strings.ReplaceAll(search, "{q}", "q"))
	if err != nil || u.Host == "" {
		return nil, fmt.Errorf("invalid address")
	}
	return &seedHub{origin: u.Scheme + "://" + u.Host, client: client}, nil
}

func (s *seedHub) get(ctx context.Context, path string, ttl time.Duration) (*goquery.Document, []byte, error) {
	target := s.origin + path
	if v, ok := seedHubCache.Load(target); ok && time.Since(v.(cachedPage).at) < ttl {
		body := v.(cachedPage).body
		doc, err := goquery.NewDocumentFromReader(strings.NewReader(string(body)))
		return doc, body, err
	}
	if err := seedHubLimit.Wait(ctx); err != nil {
		return nil, nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36")
	req.Header.Set("Accept", "text/html")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9")
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("site unreachable: %s", shortError(err))
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, nil, err
	}
	if isChallenge(resp, body) {
		return nil, nil, fmt.Errorf("site asks for a human check")
	}
	if resp.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("site answered HTTP %d", resp.StatusCode)
	}
	seedHubCache.Store(target, cachedPage{body: body, at: time.Now()})
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(string(body)))
	return doc, body, err
}

var (
	movieHref = regexp.MustCompile(`^/movies/(\d+)/?`)
	yearInfo  = regexp.MustCompile(`^\s*(\d{4})\s*/\s*([^/]+?)\s*/`)
	seedHref  = regexp.MustCompile(`seed_id=(\d+)`)
	magnetB64 = regexp.MustCompile(`const\s+data\s*=\s*"([A-Za-z0-9+/=]+)"`)
	sizeTail  = regexp.MustCompile(`\[\d+(?:\.\d+)?\s*[TGMK]i?B?\]\s*$`)
)

func (s *seedHub) Titles(ctx context.Context, query string) ([]ResourceTitle, error) {
	doc, _, err := s.get(ctx, "/s/"+url.PathEscape(strings.TrimSpace(query))+"/", 10*time.Minute)
	if err != nil {
		return nil, err
	}
	out := []ResourceTitle{}
	doc.Find(".cover-container .cover").Each(func(_ int, cover *goquery.Selection) {
		link := cover.Find("a.image").First()
		href, _ := link.Attr("href")
		m := movieHref.FindStringSubmatch(href)
		if m == nil {
			return
		}
		t := ResourceTitle{ID: m[1], URL: s.origin + href}
		t.Title = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(cover.Find("h2").Text()), "#"))
		if t.Title == "" {
			t.Title, _ = link.Attr("title")
		}
		if alt, ok := link.Attr("title"); ok && alt != t.Title {
			t.Info = strings.TrimSpace(strings.TrimPrefix(alt, t.Title))
		}
		t.Image, _ = cover.Find("img").Attr("src")
		cover.Find("ul li").Each(func(_ int, li *goquery.Selection) {
			text := strings.TrimSpace(li.Text())
			if y := yearInfo.FindStringSubmatch(text); y != nil && t.Year == 0 {
				t.Year, _ = strconv.Atoi(y[1])
				t.Kind = y[2]
			}
			if strings.HasPrefix(text, "豆瓣评分") {
				t.Rating, _ = strconv.ParseFloat(strings.TrimSpace(li.Find("a").Text()), 64)
			}
		})
		out = append(out, t)
	})
	return out, nil
}

func (s *seedHub) Seeds(ctx context.Context, id string) ([]ResourceSeed, error) {
	if _, err := strconv.Atoi(id); err != nil {
		return nil, fmt.Errorf("invalid id")
	}
	doc, _, err := s.get(ctx, "/movies/"+id+"/", 10*time.Minute)
	if err != nil {
		return nil, err
	}
	out := []ResourceSeed{}
	doc.Find("ul.seeds li").Each(func(_ int, li *goquery.Selection) {
		link := li.Find("a").First()
		href, _ := link.Attr("href")
		m := seedHref.FindStringSubmatch(href)
		if m == nil {
			return
		}
		title, _ := link.Attr("title")
		seed := ResourceSeed{ID: m[1], Title: strings.TrimSpace(sizeTail.ReplaceAllString(title, "")), Size: strings.TrimSpace(li.Find(".size").Text())}
		li.Find(".seed-feature").Each(func(_ int, f *goquery.Selection) {
			if text := strings.TrimSpace(f.Text()); text != "" {
				seed.Features = append(seed.Features, text)
			}
		})
		seed.Date = strings.TrimSpace(li.Find(".create-time").Text())
		out = append(out, seed)
	})
	return out, nil
}

func (s *seedHub) Magnet(ctx context.Context, seed string) (string, error) {
	if _, err := strconv.Atoi(seed); err != nil {
		return "", fmt.Errorf("invalid seed")
	}
	_, body, err := s.get(ctx, "/link_start/?seed_id="+seed, time.Hour)
	if err != nil {
		return "", err
	}
	m := magnetB64.FindSubmatch(body)
	if m == nil {
		return "", fmt.Errorf("no magnet on the page")
	}
	raw, err := base64.StdEncoding.DecodeString(string(m[1]))
	if err != nil || !strings.HasPrefix(string(raw), "magnet:?") {
		return "", fmt.Errorf("no magnet on the page")
	}
	return string(raw), nil
}
