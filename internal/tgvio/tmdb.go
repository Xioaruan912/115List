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
	stdpath "path"
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
	Name     string  `json:"name,omitempty"` // the folder or file name it was found for
	Rev      int     `json:"rev,omitempty"`  // name-cleaning revision that produced a "none"
	Dir      string  `json:"dir,omitempty"`  // the folder the name was seen in (real path)
	Season   int     `json:"season,omitempty"`
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
	releaseJunk = regexp.MustCompile(`(?i)\b(2160p|1080p|720p|480p|4k|uhd|hdr10?\+?|hdr|dv|dolby ?vision|web-?dl|web-?rip|webrip|blu-?ray|bdrip|remux|x26[45]|h\.?26[45]|hevc|avc|aac|ddp?\d?\.?\d?|atmos|truehd|dts(-hd)?|10bit|ma|hmax|nf|amzn|dsnp|repack|proper|complete|s\d{1,2}(e\d{1,3})?|season ?\d{1,2})\b`)
	// Chinese has no word boundaries: season and series markers go without \b.
	cjkSeason = regexp.MustCompile(`第[0-9一二三四五六七八九十百]{1,3}[季部集辑期]|[一二三四五六七八九十]部曲|系列|全[0-9一二三四五六七八九十]+[季部集]`)
	cjkJunk   = regexp.MustCompile(`(国粤语|国语|粤语|中字|中英字幕|简繁|双语|原盘|全集|合集|特效字幕|蓝光|高清|超清|完结|更新至.*|全\d+集|\d+\s*-\s*\d+\s*[集部])`)
	spaces    = regexp.MustCompile(`\s+`)
	// A folder of several films ("[周星驰] [原盘电影集 国粤语]") names no one film.
	collection = regexp.MustCompile(`电影集|作品集|合集|全集|系列|collection`)
)

// cleanerRev changes whenever CleanName gets better: names that found nothing
// under an older revision are looked up again.
const cleanerRev = 4

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
	cut = cjkSeason.ReplaceAllString(cut, " ")
	cut = cjkJunk.ReplaceAllString(cut, " ")
	cut = strings.Trim(spaces.ReplaceAllString(cut, " "), " .-_")
	// A name made only of tags ("[大话西游][1-2集][1994-1995][国粤双语]") keeps
	// its title in the first tag that still says something once cleaned.
	if !hasLetter(cut) && !collection.MatchString(name) {
		cut = ""
		for _, tag := range brackets.FindAllString(name, -1) {
			inner := strings.Trim(tag, "[]【】{}")
			if year > 0 {
				if i := strings.Index(inner, strconv.Itoa(year)); i > 0 {
					inner = inner[:i]
				}
			}
			inner = releaseJunk.ReplaceAllString(inner, " ")
			inner = cjkSeason.ReplaceAllString(inner, " ")
			inner = cjkJunk.ReplaceAllString(inner, " ")
			inner = strings.Trim(spaces.ReplaceAllString(inner, " "), " .-_")
			if hasLetter(inner) && !strings.Contains(inner, "@") {
				cut = inner
				break
			}
		}
	}
	// Episode files ("01", "E05") and bare numbers name nothing.
	if !hasLetter(cut) {
		cut = ""
	}
	return cut, year, tmdbID, imdbID
}

func hasLetter(s string) bool {
	return strings.IndexFunc(s, func(r rune) bool { return unicode.IsLetter(r) }) >= 0
}

var (
	seasonCN    = regexp.MustCompile(`第\s*([0-9一二三四五六七八九十]{1,3})\s*[季部]`)
	seasonEN    = regexp.MustCompile(`(?i)\bseason[ ._-]?(\d{1,2})\b`)
	seasonShort = regexp.MustCompile(`(?i)(?:^|[\s._\-\[(])s(\d{1,2})(?:e\d{1,3})?(?:$|[\s._\-\])])`)
	episodeTag  = regexp.MustCompile(`(?i)s\d{1,2}[ ._-]?e\d{1,3}|(?:^|[\s._\-\[])e[p]?\d{1,3}(?:$|[\s._\-\]])|第\s*\d{1,4}\s*[集话話]`)
	adultCode   = regexp.MustCompile(`(?i)^(?:[\w.]+@)?[a-z]{2,6}-?\d{3,5}(?:[^\d]|$)`)
	videoExt    = regexp.MustCompile(`(?i)\.(mp4|mkv|avi|mov|wmv|flv|ts|m2ts|rmvb|webm|m4v)$`)
)

func cnNumber(s string) int {
	if n, err := strconv.Atoi(s); err == nil {
		return n
	}
	digits := map[rune]int{'一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9}
	n, unit := 0, 0
	for _, r := range s {
		if r == '十' {
			if unit == 0 {
				unit = 1
			}
			n += unit * 10
			unit = 0
		} else if d, ok := digits[r]; ok {
			unit = d
		}
	}
	return n + unit
}

// SeasonOf reads a season number from a name: 第二季, Season 2, S02.
func SeasonOf(name string) int {
	if m := seasonCN.FindStringSubmatch(name); m != nil {
		return cnNumber(m[1])
	}
	if m := seasonEN.FindStringSubmatch(name); m != nil {
		n, _ := strconv.Atoi(m[1])
		return n
	}
	if m := seasonShort.FindStringSubmatch(extension.ReplaceAllString(name, "")); m != nil {
		n, _ := strconv.Atoi(m[1])
		return n
	}
	return 0
}

// Skip reports names not worth asking a film database about: episode files
// (the series folder carries the poster) and adult release codes.
func Skip(name string) bool {
	if adultCode.MatchString(name) {
		return true
	}
	return videoExt.MatchString(name) && episodeTag.MatchString(extension.ReplaceAllString(name, ""))
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
	cfgOnce sync.Once
	cfgMu   sync.RWMutex
	cfg     PosterConfig
	saveAt  *time.Timer
	queue   chan lookupJob
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
			queue:   make(chan lookupJob, 4096),
			queued:  map[string]bool{},
		}
		if raw, err := os.ReadFile(filepath.Join(dir, "posters.json")); err == nil {
			_ = json.Unmarshal(raw, &t.entries)
			// "Nothing found" entries from before folders were recorded can never
			// be pruned when their folder goes away: forget them, they come back
			// (with their folder) the next time they are seen.
			for key, entry := range t.entries {
				if entry.None && !entry.Manual && entry.Dir == "" {
					delete(t.entries, key)
				}
			}
		}
		go t.work()
		tmdbInstance = t
	})
	return tmdbInstance
}

func (t *TMDB) Enabled() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.token != ""
}

func (t *TMDB) get(ctx context.Context, path string, query url.Values, out any) error {
	return t.getIn(ctx, t.Config().Language, path, query, out)
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
	t.mu.Lock()
	token := t.token
	t.mu.Unlock()
	// A v4 read token goes in the header; a v3 API key (32 hex) in the query.
	if len(token) == 32 && !strings.Contains(token, ".") {
		q := req.URL.Query()
		q.Set("api_key", token)
		req.URL.RawQuery = q.Encode()
	} else {
		req.Header.Set("Authorization", "Bearer "+token)
	}
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
		} else if year > 0 && p.Year > 0 && p.Year-year >= -1 && p.Year-year <= 1 {
			score += 20 // "[1994-1995]" names the first year of a pair
		} else if year > 0 && p.Year > 0 && (p.Year-year > 3 || year-p.Year > 3) {
			score -= 25 // a sequel or remake decades apart
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

// lookup finds the best poster for a name (its season's, for a season), or a "none" entry.
func (t *TMDB) lookup(ctx context.Context, name string) (*Poster, error) {
	p, err := t.lookupBase(ctx, name)
	if err != nil || p.None || p.Kind != "tv" {
		return p, err
	}
	if season := SeasonOf(name); season > 0 {
		t.ApplySeason(ctx, p, season)
	}
	return p, nil
}

type tmdbSeason struct {
	SeasonNumber int    `json:"season_number"`
	Name         string `json:"name"`
	PosterPath   string `json:"poster_path"`
	AirDate      string `json:"air_date"`
	Overview     string `json:"overview"`
	EpisodeCount int    `json:"episode_count"`
}

// ApplySeason turns a series' poster into one season's, when TMDB has it.
func (t *TMDB) ApplySeason(ctx context.Context, p *Poster, season int) {
	var s tmdbSeason
	if err := t.get(ctx, "tv/"+strconv.Itoa(p.ID)+"/season/"+strconv.Itoa(season), nil, &s); err != nil {
		return
	}
	p.Season = season
	if s.PosterPath != "" {
		p.Poster = s.PosterPath
	}
	if s.Name != "" && !strings.Contains(p.Title, s.Name) {
		p.Title = p.Title + " " + s.Name
	}
	if len(s.AirDate) >= 4 {
		p.Year, _ = strconv.Atoi(s.AirDate[:4])
	}
	if s.Overview != "" {
		p.Overview = s.Overview
	}
}

// SeasonInfo is one season of a series, for choosing by hand.
type SeasonInfo struct {
	Season   int    `json:"season"`
	Name     string `json:"name"`
	Poster   string `json:"poster,omitempty"`
	Year     int    `json:"year,omitempty"`
	Episodes int    `json:"episodes"`
}

// Seasons lists a series' seasons.
func (t *TMDB) Seasons(ctx context.Context, id int) ([]SeasonInfo, error) {
	var show struct {
		Seasons []tmdbSeason `json:"seasons"`
	}
	if err := t.get(ctx, "tv/"+strconv.Itoa(id), nil, &show); err != nil {
		return nil, err
	}
	out := []SeasonInfo{}
	for _, s := range show.Seasons {
		year := 0
		if len(s.AirDate) >= 4 {
			year, _ = strconv.Atoi(s.AirDate[:4])
		}
		out = append(out, SeasonInfo{Season: s.SeasonNumber, Name: s.Name, Poster: s.PosterPath, Year: year, Episodes: s.EpisodeCount})
	}
	// Regular seasons in order; specials (season 0) last.
	sort.SliceStable(out, func(i, j int) bool {
		if (out[i].Season == 0) != (out[j].Season == 0) {
			return out[j].Season == 0
		}
		return out[i].Season < out[j].Season
	})
	return out, nil
}

func (t *TMDB) lookupBase(ctx context.Context, name string) (*Poster, error) {
	query, year, tmdbID, imdbID := CleanName(name)
	none := &Poster{None: true, Rev: cleanerRev, At: time.Now().Unix()}
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

type lookupJob struct {
	name, dir string
	solo      bool // the folder's only video: its film is the folder's too
}

// Lookup answers for the names in one folder (dir is its real path) from the
// store, and queues unknown names for the background worker. Names no longer
// in the folder are forgotten, so deleted folders leave no trace. A bare
// season folder ("第一季", "Season 01") is looked up with its series' name.
func (t *TMDB) Lookup(dir string, names []string) (map[string]*Poster, int) {
	out := make(map[string]*Poster, len(names))
	pending := 0
	if !t.Config().Enabled || !t.Covers(dir) {
		return out, 0
	}
	effective := make(map[string]string, len(names)) // shown name -> name to look up
	present := make(map[string]bool, len(names))
	solo := ""
	for _, name := range names {
		if mediaExt.MatchString(name) {
			if solo == "" {
				solo = name
			} else {
				solo = "\x00" // more than one
			}
		}
	}
	for _, name := range names {
		if Skip(name) {
			continue
		}
		look := name
		if query, _, _, _ := CleanName(name); query == "" && SeasonOf(name) > 0 && dir != "/" {
			look = pathBase(dir) + " " + name
		}
		effective[name] = look
		present[Key(look)] = true
	}
	t.mu.Lock()
	pruned := false
	for key, entry := range t.entries {
		if entry.Dir == dir && !entry.Manual && !present[key] {
			delete(t.entries, key)
			pruned = true
		}
	}
	now := time.Now().Unix()
	for name, look := range effective {
		key := Key(look)
		entry, ok := t.entries[key]
		// "Nothing found" is retried after a week (TMDB keeps growing) or when
		// the name cleaning has improved since.
		if ok && (!entry.None || entry.Manual || (now-entry.At < 7*24*3600 && entry.Rev >= cleanerRev)) {
			out[name] = entry
			if name == solo && t.inheritLocked(dir, entry) {
				pruned = true
			}
			continue
		}
		if t.token == "" { // t.mu is held here
			continue
		}
		pending++
		if !t.queued[key] {
			select {
			case t.queue <- lookupJob{name: look, dir: dir, solo: name == solo}:
				t.queued[key] = true
			default:
			}
		}
	}
	t.mu.Unlock()
	if pruned {
		t.save()
	}
	return out, pending
}

// inheritLocked gives a folder that found nothing under its own name ("最后孤岛"
// holding "最后孤屋 (2026).mkv") the film of its only video. t.mu is held.
func (t *TMDB) inheritLocked(dir string, p *Poster) bool {
	if p == nil || p.None || p.Kind != "movie" || dir == "/" {
		return false
	}
	folder := pathBase(dir)
	key := Key(folder)
	cur := t.entries[key]
	if cur != nil && (!cur.None || cur.Manual) {
		return false
	}
	inherited := *p
	inherited.Name = folder
	inherited.Dir = stdpath.Dir(dir)
	inherited.Manual = false
	t.entries[key] = &inherited
	return true
}

// RenamedDir follows a renamed folder: entries seen inside it keep their poster.
func (t *TMDB) RenamedDir(oldPath, newPath string) {
	t.mu.Lock()
	changed := false
	for _, entry := range t.entries {
		if entry.Dir == oldPath || strings.HasPrefix(entry.Dir, oldPath+"/") {
			entry.Dir = newPath + strings.TrimPrefix(entry.Dir, oldPath)
			changed = true
		}
	}
	t.mu.Unlock()
	if changed {
		t.save()
	}
}

func pathBase(p string) string {
	p = strings.TrimRight(p, "/")
	if i := strings.LastIndex(p, "/"); i >= 0 {
		return p[i+1:]
	}
	return p
}

// Covers reports whether posters are wanted in this folder (a real path).
func (t *TMDB) Covers(dir string) bool {
	for _, root := range t.Config().Paths {
		if root == "/" || dir == root || strings.HasPrefix(dir, root+"/") {
			return true
		}
	}
	return false
}

// Set stores a choice made by a person; it wins over any lookup.
func (t *TMDB) Set(name string, p *Poster) {
	p.Manual = true
	p.Name = name
	p.At = time.Now().Unix()
	t.mu.Lock()
	t.entries[Key(name)] = p
	t.mu.Unlock()
	t.save()
}

func (t *TMDB) work() {
	for job := range t.queue {
		name := job.name
		key := Key(name)
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		p, err := t.lookup(ctx, name)
		cancel()
		t.mu.Lock()
		delete(t.queued, key)
		if err == nil {
			p.Name = name
			p.Dir = job.dir
			t.entries[key] = p
			if job.solo {
				t.inheritLocked(job.dir, p)
			}
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
	imageSizes = map[string]bool{"w300": true, "w185": true, "w342": true, "w500": true, "w780": true, "w1280": true}
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

// ---------------------------------------------------------------- settings

// PosterConfig is what an admin sets in the web UI; it lives in <data>/tgvio/tmdb.json.
type PosterConfig struct {
	Enabled  bool   `json:"enabled"`
	Language string `json:"language"`
	Blur     bool   `json:"blur"` // posters follow the cover blur like drive pictures do
	// Folders (real paths) where posters are looked up, subfolders included.
	Paths []string `json:"paths"`
}

var posterLanguages = map[string]bool{"zh-CN": true, "zh-TW": true, "zh-HK": true, "en-US": true, "ja-JP": true, "ko-KR": true}

func (t *TMDB) Config() PosterConfig {
	t.cfgOnce.Do(func() {
		t.cfg = PosterConfig{Enabled: true, Language: "zh-CN"}
		if raw, err := os.ReadFile(filepath.Join(t.dir, "tmdb.json")); err == nil {
			_ = json.Unmarshal(raw, &t.cfg)
			if !strings.Contains(string(raw), `"paths"`) {
				t.cfg.Paths = []string{"/"} // set before paths existed: keep posters everywhere
			}
		} else {
			t.cfg.Paths = []string{"/"}
		}
		if !posterLanguages[t.cfg.Language] {
			t.cfg.Language = "zh-CN"
		}
	})
	t.cfgMu.RLock()
	defer t.cfgMu.RUnlock()
	return t.cfg
}

func (t *TMDB) SetConfig(cfg PosterConfig) error {
	if !posterLanguages[cfg.Language] {
		return fmt.Errorf("unsupported language %q", cfg.Language)
	}
	cfg.Paths = CleanPaths(cfg.Paths)
	t.Config()
	t.cfgMu.Lock()
	changedLanguage := t.cfg.Language != cfg.Language
	t.cfg = cfg
	t.cfgMu.Unlock()
	raw, _ := json.Marshal(cfg)
	if err := os.MkdirAll(t.dir, 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(t.dir, "tmdb.json"), raw, 0o600); err != nil {
		return err
	}
	if changedLanguage {
		t.Reset("auto") // titles and overviews come in the new language
	}
	return nil
}

// TokenHint shows that a token is set without revealing it.
func (t *TMDB) TokenHint() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	if len(t.token) < 8 {
		return ""
	}
	return "…" + t.token[len(t.token)-4:]
}

// SetToken stores a new read token (or API key) in <data>/tgvio/tmdb_token, mode 0600.
func (t *TMDB) SetToken(token string) error {
	token = strings.TrimSpace(token)
	if err := os.MkdirAll(t.dir, 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(t.dir, "tmdb_token"), []byte(token), 0o600); err != nil {
		return err
	}
	t.mu.Lock()
	t.token = token
	t.mu.Unlock()
	return nil
}

// Test checks the token against TMDB.
func (t *TMDB) Test(ctx context.Context) error {
	if !t.Enabled() {
		return errors.New("no TMDB token")
	}
	var out map[string]any
	return t.get(ctx, "configuration", nil, &out)
}

type PosterStats struct {
	Matched    int      `json:"matched"`
	None       int      `json:"none"`
	Manual     int      `json:"manual"`
	Pending    int      `json:"pending"`
	Images     int      `json:"images"`
	ImageBytes int64    `json:"image_bytes"`
	Unmatched  []string `json:"unmatched"`
}

func (t *TMDB) Stats() PosterStats {
	st := PosterStats{Unmatched: []string{}}
	t.mu.Lock()
	for key, entry := range t.entries {
		switch {
		case entry.Manual:
			st.Manual++
		case entry.None:
			if !t.coversLocked(entry.Dir) {
				continue
			}
			st.None++
			if len(st.Unmatched) < 200 {
				name := entry.Name
				if name == "" {
					name = key
				}
				st.Unmatched = append(st.Unmatched, name)
			}
		default:
			st.Matched++
		}
	}
	st.Pending = len(t.queued)
	t.mu.Unlock()
	sort.Strings(st.Unmatched)
	_ = filepath.Walk(filepath.Join(t.dir, "posters"), func(_ string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			st.Images++
			st.ImageBytes += info.Size()
		}
		return nil
	})
	return st
}

// Reset forgets matches: "none" the names that found nothing, "auto" every
// automatic match (manual choices stay), "images" the downloaded images.
func (t *TMDB) Reset(scope string) int {
	n := 0
	switch scope {
	case "images":
		_ = filepath.Walk(filepath.Join(t.dir, "posters"), func(path string, info os.FileInfo, err error) error {
			if err == nil && !info.IsDir() && os.Remove(path) == nil {
				n++
			}
			return nil
		})
		return n
	case "none", "auto":
		t.mu.Lock()
		for key, entry := range t.entries {
			if !entry.Manual && (scope == "auto" || entry.None) {
				delete(t.entries, key)
				n++
			}
		}
		t.mu.Unlock()
		t.save()
	}
	return n
}

// CleanPaths normalises a list of folder paths: absolute, no trailing slash,
// no duplicates, none inside another one of the list.
func CleanPaths(paths []string) []string {
	seen := map[string]bool{}
	var list []string
	for _, p := range paths {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		p = "/" + strings.Trim(stdpath.Clean("/"+p), "/")
		if !seen[p] {
			seen[p] = true
			list = append(list, p)
		}
	}
	sort.Strings(list)
	out := []string{}
	for _, p := range list {
		inside := false
		for _, q := range out {
			if q == "/" || strings.HasPrefix(p, q+"/") {
				inside = true
				break
			}
		}
		if !inside {
			out = append(out, p)
		}
	}
	return out
}

func (t *TMDB) coversLocked(dir string) bool {
	t.cfgMu.RLock()
	defer t.cfgMu.RUnlock()
	for _, root := range t.cfg.Paths {
		if root == "/" || dir == root || strings.HasPrefix(dir, root+"/") {
			return true
		}
	}
	return false
}
