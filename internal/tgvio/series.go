package tgvio

import (
	"context"
	stdpath "path"
	"sort"
	"strconv"
	"sync"
	"time"
)

// The series page: what a folder of a TV series is (the series, which season),
// TMDB's episodes of that season with stills and synopses, and which file of
// the folder is which episode. A series' own folder (holding season folders)
// gets its seasons, each pointed at its folder. Everything comes from the
// poster store and TMDB (cached for half a day), never from the drive.

// SeriesEpisode is one episode of the season, with its file when the folder has it.
type SeriesEpisode struct {
	Episode  int     `json:"episode"`
	Name     string  `json:"name,omitempty"`
	Overview string  `json:"overview,omitempty"`
	Still    string  `json:"still,omitempty"`
	Air      string  `json:"air,omitempty"`
	Runtime  int     `json:"runtime,omitempty"`
	Rating   float64 `json:"rating,omitempty"`
	File     string  `json:"file,omitempty"`
}

// SeriesSeason is one season of the series and, when known, its folder here.
type SeriesSeason struct {
	SeasonInfo
	Folder string `json:"folder,omitempty"`
}

// SeriesView is what the series page shows for one folder.
type SeriesView struct {
	Base    *Poster // the series itself (title, synopsis, backdrop)
	Subject *Poster // what the folder matched (a season's poster for a season folder)
	// Season the folder holds; 0 for the series' own folder of season folders.
	Season   int
	Seasons  []SeriesSeason
	Episodes []SeriesEpisode
	// Extra: video files of the folder that are no episode of the season.
	Extra []string
}

var detailsCache sync.Map // "kind/id/language" -> detailsEntry

type detailsEntry struct {
	at time.Time
	p  *Poster
}

// cachedDetails is Details kept for half a day.
func (t *TMDB) cachedDetails(ctx context.Context, kind string, id int) (*Poster, error) {
	key := kind + "/" + strconv.Itoa(id) + "/" + t.Config().Language
	if v, ok := detailsCache.Load(key); ok && time.Since(v.(detailsEntry).at) < 12*time.Hour {
		return v.(detailsEntry).p, nil
	}
	p, err := t.Details(ctx, kind, id)
	if err != nil {
		return nil, err
	}
	detailsCache.Store(key, detailsEntry{at: time.Now(), p: p})
	return p, nil
}

// cachedSeasons is Seasons kept for half a day.
func (t *TMDB) cachedSeasons(ctx context.Context, id int) []SeasonInfo {
	if v, ok := seasonsCache.Load(id); ok && time.Since(v.(seasonsEntry).at) < 12*time.Hour {
		return v.(seasonsEntry).list
	}
	list, err := t.Seasons(ctx, id)
	if err != nil {
		return nil
	}
	seasonsCache.Store(id, seasonsEntry{at: time.Now(), list: list})
	return list
}

// Series builds the series page of a folder; nil when the folder is no series.
func (t *TMDB) Series(ctx context.Context, dir string, entries []RenameEntry) (*SeriesView, error) {
	if !t.Enabled() || !t.Config().Enabled || !t.Covers(dir) || dir == "/" {
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	subject, err := t.subjectOf(ctx, dir, entries)
	if err != nil || subject == nil || subject.None || subject.Kind != "tv" {
		return nil, err
	}
	base, err := t.cachedDetails(ctx, "tv", subject.ID)
	if err != nil {
		return nil, err
	}
	view := &SeriesView{Base: base, Subject: subject}
	seasons := t.cachedSeasons(ctx, subject.ID)
	counts, last := map[int]int{}, 0
	for _, s := range seasons {
		counts[s.Season] = s.Episodes
		if s.Season > last {
			last = s.Season
		}
	}

	// Season folders inside: "第二季", "Season 2", "我们这一天 第五季 (2020)".
	folders := map[int]string{}
	var videos []string
	for _, e := range entries {
		switch {
		case e.IsDir:
			if s := SeasonOf(e.Name); s > 0 && folders[s] == "" {
				folders[s] = e.Name
			}
		case mediaExt.MatchString(e.Name):
			videos = append(videos, e.Name)
		}
	}
	sort.Strings(videos)
	for _, s := range seasons {
		view.Seasons = append(view.Seasons, SeriesSeason{SeasonInfo: s, Folder: folders[s.Season]})
	}
	if len(videos) == 0 {
		return view, nil // the series' own folder: its seasons only
	}

	// The season of this folder, as the rename planner reads it.
	folder := pathBase(dir)
	season := subject.Season
	if season == 0 {
		season = SeasonOf(folder)
	}
	if season == 0 {
		named := map[int]int{}
		for _, v := range videos {
			if s, _ := ParseEpisode(v); s > 0 {
				named[s]++
			}
		}
		best := 0
		for s, n := range named {
			if n > named[best] || (n == named[best] && s < best) {
				best = s
			}
		}
		season = best
	}
	fixed := season > 0
	if season == 0 {
		season = 1
	}
	view.Season = season

	files := map[int]string{}
	for _, v := range videos {
		s, ep := ParseEpisode(v)
		if ep == 0 {
			view.Extra = append(view.Extra, v)
			continue
		}
		explicit := s > 0
		if fixed || s == 0 {
			s = season
		}
		s, ep = placeEpisode(counts, last, s, ep, explicit)
		if s != season || files[ep] != "" {
			view.Extra = append(view.Extra, v)
			continue
		}
		files[ep] = v
	}
	cached := t.episodes(ctx, subject.ID, season)
	seen := map[int]bool{}
	for _, e := range cached.list {
		name := e.Name
		if genericEpisode.MatchString(name) {
			name = ""
		}
		view.Episodes = append(view.Episodes, SeriesEpisode{Episode: e.EpisodeNumber, Name: name, Overview: e.Overview, Still: e.StillPath,
			Air: e.AirDate, Runtime: e.Runtime, Rating: e.VoteAverage, File: files[e.EpisodeNumber]})
		seen[e.EpisodeNumber] = true
	}
	// Files beyond what TMDB lists (a season still airing, a special) keep their place.
	for ep, file := range files {
		if !seen[ep] {
			view.Episodes = append(view.Episodes, SeriesEpisode{Episode: ep, File: file})
		}
	}
	sort.Slice(view.Episodes, func(i, j int) bool { return view.Episodes[i].Episode < view.Episodes[j].Episode })
	return view, nil
}

// SeriesRoot is the series' own folder above a season folder: the parent, when
// the poster store knows it as the same series ("剧集" holding many is no root).
func (t *TMDB) SeriesRoot(dir string, view *SeriesView) string {
	if view == nil || view.Season == 0 || dir == "/" {
		return ""
	}
	parent := stdpath.Dir(dir)
	t.mu.Lock()
	entry := t.entries[Key(pathBase(parent))]
	t.mu.Unlock()
	if entry == nil || entry.None || entry.Kind != "tv" || entry.ID != view.Base.ID {
		return ""
	}
	return parent
}
