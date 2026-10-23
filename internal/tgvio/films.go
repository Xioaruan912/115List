package tgvio

import (
	"context"
	"sort"
	"strconv"
	"sync"
	"time"
)

// The film-series page: a folder of films of one TMDB collection ("福尔摩斯小
// 姐" with its three films), or one film of a collection, shows the whole
// collection: every film, which ones are here (and where), which are missing,
// which are not out yet. From the poster store and TMDB (cached for half a
// day), never from the drive beyond the folder's own listing.

// FilmPart is one film of the collection.
type FilmPart struct {
	ID       int     `json:"id"`
	Title    string  `json:"title"`
	Original string  `json:"original,omitempty"`
	Year     int     `json:"year,omitempty"`
	Release  string  `json:"release,omitempty"` // "2026-03-01"; empty when TMDB has no date
	Poster   string  `json:"poster,omitempty"`
	Backdrop string  `json:"backdrop,omitempty"`
	Overview string  `json:"overview,omitempty"`
	Rating   float64 `json:"rating,omitempty"`
	// Place: the folder or video here that is this film; "." for the folder itself; empty when missing.
	Place string `json:"place,omitempty"`
	// Released: out already (TMDB release date today or before).
	Released bool `json:"released"`
}

// FilmsView is the collection a folder belongs to.
type FilmsView struct {
	ID       int        `json:"id"`
	Name     string     `json:"name"`
	Overview string     `json:"overview,omitempty"`
	Poster   string     `json:"poster,omitempty"`
	Backdrop string     `json:"backdrop,omitempty"`
	Parts    []FilmPart `json:"parts"`
}

type tmdbCollection struct {
	ID           int        `json:"id"`
	Name         string     `json:"name"`
	Overview     string     `json:"overview"`
	PosterPath   string     `json:"poster_path"`
	BackdropPath string     `json:"backdrop_path"`
	Parts        []tmdbItem `json:"parts"`
}

type collectionEntry struct {
	at time.Time
	c  *tmdbCollection
}

var collectionCache sync.Map // "id/language" -> collectionEntry

// Collection reads a TMDB collection with its films, kept for half a day.
func (t *TMDB) Collection(ctx context.Context, id int) (*tmdbCollection, error) {
	key := strconv.Itoa(id) + "/" + t.Config().Language
	if v, ok := collectionCache.Load(key); ok && time.Since(v.(collectionEntry).at) < 12*time.Hour {
		return v.(collectionEntry).c, nil
	}
	var c tmdbCollection
	if err := t.get(ctx, "collection/"+strconv.Itoa(id), nil, &c); err != nil {
		return nil, err
	}
	collectionCache.Store(key, collectionEntry{at: time.Now(), c: &c})
	return &c, nil
}

// filmsMax: a folder holding more films than this is a library shelf, not one series.
const filmsMax = 16

// Films finds the collection a folder's films belong to; nil when there is
// none, or the folder holds several series (a library root, a mixed shelf).
func (t *TMDB) Films(ctx context.Context, dir string, entries []RenameEntry) (*FilmsView, error) {
	if !t.Enabled() || !t.Config().Enabled || !t.Covers(dir) || dir == "/" {
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	// The films here: the folder itself when it is one, and its subfolders and videos.
	type here struct {
		place string
		p     *Poster
	}
	var films []here
	candidates := 0
	for _, e := range entries {
		if Skip(e.Name) || !e.IsDir && !mediaExt.MatchString(e.Name) {
			continue
		}
		candidates++
		if candidates > filmsMax {
			return nil, nil
		}
	}
	if self, err := t.subjectOf(ctx, dir, entries); err == nil && self != nil && !self.None && self.Kind == "movie" {
		videos := 0
		for _, e := range entries {
			if !e.IsDir && mediaExt.MatchString(e.Name) {
				videos++
			}
		}
		// A folder of one film (its video, maybe in parts): the film is the folder.
		if videos > 0 && videos <= 2 && candidates == videos {
			films = append(films, here{".", self})
		}
	}
	if len(films) == 0 {
		for _, e := range entries {
			if Skip(e.Name) || !e.IsDir && !mediaExt.MatchString(e.Name) {
				continue
			}
			p, err := t.resolve(ctx, e.Name, dir)
			if err != nil {
				return nil, err
			}
			if !p.None && p.Kind == "movie" {
				films = append(films, here{e.Name, p})
			}
		}
	}
	if len(films) == 0 {
		return nil, nil
	}
	// Each film's collection, from its details; the one most of them share.
	counts := map[int]int{}
	byFilm := map[int]string{} // film id -> place here
	for _, f := range films {
		d, err := t.cachedDetails(ctx, "movie", f.p.ID)
		if err != nil || d.Collection == 0 {
			continue
		}
		counts[d.Collection]++
		if byFilm[f.p.ID] == "" {
			byFilm[f.p.ID] = f.place
		}
	}
	best, top := 0, 0
	for id, n := range counts {
		if n > top || n == top && id < best {
			best, top = id, n
		}
	}
	// Most of what is here has to be of that series (a shelf of many series is no series page).
	if best == 0 || top*10 < len(films)*6 {
		return nil, nil
	}
	c, err := t.Collection(ctx, best)
	if err != nil {
		return nil, err
	}
	today := time.Now().Format("2006-01-02")
	view := &FilmsView{ID: c.ID, Name: c.Name, Overview: c.Overview, Poster: c.PosterPath, Backdrop: c.BackdropPath}
	for _, item := range c.Parts {
		p := item.poster("movie")
		view.Parts = append(view.Parts, FilmPart{ID: p.ID, Title: p.Title, Original: p.Original, Year: p.Year, Release: item.ReleaseDate,
			Poster: p.Poster, Backdrop: p.Backdrop, Overview: p.Overview, Rating: p.Rating, Place: byFilm[p.ID],
			Released: item.ReleaseDate != "" && item.ReleaseDate <= today})
	}
	// In release order; films without a date (announced) last.
	sort.SliceStable(view.Parts, func(i, j int) bool {
		a, b := view.Parts[i].Release, view.Parts[j].Release
		if (a == "") != (b == "") {
			return b == ""
		}
		return a < b
	})
	return view, nil
}
