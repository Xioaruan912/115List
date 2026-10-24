package tgvio

import (
	"context"
	stdpath "path"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// What is new for the library (追剧与新片), from the poster records and TMDB:
//
//	season    a season aired after the last one here (第 3 季已播出)
//	upcoming  a season or a film of a series here comes soon (11 月 3 日开播 / 上映)
//	episode   the season being followed has its next episode soon
//	missing   films of a series here are out but not here (系列里还有 2 部)
//	gap       older seasons of a series here that are not here (还差 6 季)
//
// Worked out in the background at most every 12 hours (a few hundred TMDB
// requests the first time), kept in memory.

type NewsItem struct {
	Kind    string   `json:"kind"`
	ID      int      `json:"id"`               // TMDB: the series, or the film (missing: the series' collection)
	Title   string   `json:"title"`            // the series or collection, as the library names it
	Poster  string   `json:"poster,omitempty"` // TMDB path
	Dir     string   `json:"dir,omitempty"`    // real path of its folder here
	Date    string   `json:"date,omitempty"`   // "2026-11-03"
	Season  int      `json:"season,omitempty"`
	Episode int      `json:"episode,omitempty"`
	Name    string   `json:"name,omitempty"`    // the episode's or the film's own title
	Missing []string `json:"missing,omitempty"` // missing / gap: titles or seasons not here, oldest first
	Seasons []int    `json:"seasons,omitempty"` // gap: the seasons not here
	Query   string   `json:"query,omitempty"`   // what 找资源 searches
	// Into: for an episode, the folder of its season here (real path), where it goes.
	Into string `json:"into,omitempty"`
}

type newsState struct {
	mu      sync.Mutex
	items   []NewsItem
	at      time.Time
	running bool
}

var news newsState

const newsEvery = 12 * time.Hour

// News returns what is known, and starts working it out again when it is old.
func (t *TMDB) News() (items []NewsItem, computing bool, at time.Time) {
	news.mu.Lock()
	defer news.mu.Unlock()
	if !news.running && time.Since(news.at) > newsEvery && t.Enabled() {
		news.running = true
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
			defer cancel()
			out := t.computeNews(ctx)
			news.mu.Lock()
			news.items, news.at, news.running = out, time.Now(), false
			news.mu.Unlock()
		}()
	}
	return append([]NewsItem(nil), news.items...), news.running, news.at
}

type tvNext struct {
	Next *struct {
		AirDate string `json:"air_date"`
		Season  int    `json:"season_number"`
		Episode int    `json:"episode_number"`
		Name    string `json:"name"`
	} `json:"next_episode_to_air"`
	Status string `json:"status"`
}

func (t *TMDB) computeNews(ctx context.Context) []NewsItem {
	today := time.Now().Format("2006-01-02")
	soon := time.Now().AddDate(0, 0, 90).Format("2006-01-02")
	week := time.Now().AddDate(0, 0, 14).Format("2006-01-02")
	lastYear := time.Now().AddDate(-1, 0, 0).Format("2006-01-02")
	type series struct {
		p       Poster
		dir     string
		seasons map[int]bool
		at      map[int]string // season -> its folder here
	}
	shows := map[int]*series{}
	films := map[int]Poster{} // id -> a record of it
	filmDir := map[int]string{}
	for _, e := range t.Library() {
		if !t.InLibrary(e.Dir) {
			continue
		}
		switch e.Kind {
		case "tv":
			s := shows[e.ID]
			if s == nil {
				s = &series{p: e, seasons: map[int]bool{}, at: map[int]string{}}
				shows[e.ID] = s
			}
			if e.Season > 0 {
				s.seasons[e.Season] = true
				if !strings.HasPrefix(e.Name, pathBase(e.Dir)+" ") { // a real season folder, not "series + 第一季"
					s.at[e.Season] = stdpath.Join(e.Dir, e.Name)
				}
			}
			// The series' own folder: a record without a season, else the folder above a season's.
			here := stdpath.Join(e.Dir, e.Name)
			if e.Season > 0 {
				here = e.Dir
			}
			if s.dir == "" || e.Season == 0 && len(here) < len(s.dir) {
				s.dir = here
			}
		case "movie":
			if _, ok := films[e.ID]; !ok || !IsMediaFile(e.Name) {
				films[e.ID], filmDir[e.ID] = e, e.Dir
			}
		}
	}
	var out []NewsItem
	for id, s := range shows {
		if ctx.Err() != nil {
			break
		}
		base, err := t.cachedDetails(ctx, "tv", id)
		if err != nil {
			continue
		}
		last := 0
		for n := range s.seasons {
			if n > last {
				last = n
			}
		}
		// A series here only as a season folder ("校外 第一季 (2026)" in the library's root): that folder.
		if (s.dir == "" || t.isRoot(s.dir)) && s.at[last] != "" {
			s.dir = s.at[last]
		}
		gap := NewsItem{Kind: "gap", ID: id, Title: base.Title, Poster: base.Poster, Dir: s.dir, Query: base.Title}
		for _, info := range t.cachedSeasons(ctx, id) {
			if info.Season <= 0 || info.Air == "" || info.Season <= last {
				continue
			}
			item := NewsItem{ID: id, Title: base.Title, Poster: firstOf(info.Poster, base.Poster), Dir: s.dir, Date: info.Air, Season: info.Season,
				Query: base.Title}
			switch {
			case last > 0 && info.Air <= today && info.Air >= lastYear:
				item.Kind = "season" // new: aired in the last year
			case last > 0 && info.Air < lastYear:
				gap.Seasons = append(gap.Seasons, info.Season)
				gap.Missing = append(gap.Missing, "第"+cnNumeral(info.Season)+"季")
				continue
			case info.Air > today && info.Air <= soon:
				item.Kind = "upcoming"
			default:
				continue
			}
			out = append(out, item)
		}
		if len(gap.Seasons) > 0 {
			out = append(out, gap)
		}
		var next tvNext
		if err := t.get(ctx, "tv/"+strconv.Itoa(id), nil, &next); err == nil && next.Next != nil && next.Next.AirDate >= today && next.Next.AirDate <= week &&
			(last == 0 || next.Next.Season <= last) {
			out = append(out, NewsItem{Kind: "episode", ID: id, Title: base.Title, Poster: base.Poster, Dir: s.dir, Date: next.Next.AirDate,
				Season: next.Next.Season, Episode: next.Next.Episode, Name: next.Next.Name, Query: base.Title, Into: s.at[next.Next.Season]})
		}
	}
	// Films: by their TMDB series.
	byCollection := map[int][]int{}
	for id := range films {
		if ctx.Err() != nil {
			break
		}
		d, err := t.cachedDetails(ctx, "movie", id)
		if err != nil || d.Collection == 0 {
			continue
		}
		byCollection[d.Collection] = append(byCollection[d.Collection], id)
	}
	for cid, have := range byCollection {
		if ctx.Err() != nil {
			break
		}
		c, err := t.Collection(ctx, cid)
		if err != nil {
			continue
		}
		here := map[int]bool{}
		dirs := map[string]int{}
		for _, id := range have {
			here[id] = true
			dirs[filmDir[id]]++
		}
		dir := ""
		for d, n := range dirs {
			if !t.isRoot(d) && (dir == "" || n > dirs[dir]) {
				dir = d
			}
		}
		name := collectionSuffix.ReplaceAllString(c.Name, "")
		parts := append([]tmdbItem(nil), c.Parts...)
		sort.Slice(parts, func(i, j int) bool { return parts[i].ReleaseDate < parts[j].ReleaseDate })
		var missing []string
		for _, part := range parts {
			if here[part.ID] || part.ReleaseDate == "" {
				continue
			}
			p := part.poster("movie")
			switch {
			case part.ReleaseDate <= today:
				missing = append(missing, titleYear(SafeName(p.Title), p.Year))
			case part.ReleaseDate <= soon:
				out = append(out, NewsItem{Kind: "upcoming", ID: part.ID, Title: name, Poster: firstOf(p.Poster, c.PosterPath), Dir: dir,
					Date: part.ReleaseDate, Name: SafeName(p.Title), Query: SafeName(p.Title)})
			}
		}
		if len(missing) > 0 {
			out = append(out, NewsItem{Kind: "missing", ID: cid, Title: name, Poster: c.PosterPath, Dir: dir, Missing: missing, Query: name})
		}
	}
	// Soonest and newest first: aired seasons, next episodes, coming, then series with gaps.
	rank := map[string]int{"season": 0, "episode": 1, "upcoming": 2, "missing": 3, "gap": 4}
	sort.SliceStable(out, func(i, j int) bool {
		if rank[out[i].Kind] != rank[out[j].Kind] {
			return rank[out[i].Kind] < rank[out[j].Kind]
		}
		if out[i].Kind == "season" {
			return out[i].Date > out[j].Date
		}
		if out[i].Kind == "missing" || out[i].Kind == "gap" {
			return len(out[i].Missing) < len(out[j].Missing)
		}
		return out[i].Date < out[j].Date
	})
	return out
}

func firstOf(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
