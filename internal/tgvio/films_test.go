package tgvio

import (
	"context"
	"encoding/json"
	"strconv"
	"testing"
)

func filmsTMDB(t *testing.T, films []tmdbItem, names map[string]int) *TMDB {
	tm := planTMDB(t, films, names)
	tm.cfgOnce.Do(func() {})
	tm.cfg = PosterConfig{Enabled: true, Language: "zh-CN", Paths: []string{"/lib"}}
	return tm
}

func TestFilmsOneFilmOfNoSeries(t *testing.T) {
	// "功夫 (2004)" holding its disc: the film itself, though it is of no TMDB collection.
	tm := filmsTMDB(t, []tmdbItem{film(10, "功夫", "2004-12-23", 0, "")}, map[string]int{"功夫 (2004)": 10})
	view, err := tm.Films(context.Background(), "/lib/周星驰/功夫 (2004)", []RenameEntry{{Name: "功夫 (2004).iso", Size: 9}})
	if err != nil {
		t.Fatal(err)
	}
	if view == nil || view.Kind != "film" || view.Film == nil || view.Film.ID != 10 || view.Film.Place != "." || view.Name != "功夫" {
		t.Fatalf("view -> %+v", view)
	}
}

func TestFilmsShelfOfNoSeries(t *testing.T) {
	// A shelf of someone's films, of no one collection: every title here, by year; never the library's root.
	tm := filmsTMDB(t, []tmdbItem{film(10, "功夫", "2004-12-23", 0, ""), film(11, "喜剧之王", "1999-02-13", 0, ""),
		film(12, "赌侠", "1990-07-14", 5, "赌侠（系列）")},
		map[string]int{"功夫 (2004)": 10, "喜剧之王 (1999)": 11, "赌侠": 12})
	entries := []RenameEntry{{Name: "功夫 (2004)", IsDir: true}, {Name: "喜剧之王 (1999)", IsDir: true}, {Name: "赌侠", IsDir: true},
		{Name: "说明.txt"}}
	view, err := tm.Films(context.Background(), "/lib/周星驰电影合集", entries)
	if err != nil {
		t.Fatal(err)
	}
	if view == nil || view.Kind != "shelf" || view.Name != "周星驰电影合集" || len(view.Parts) != 3 {
		t.Fatalf("view -> %+v", view)
	}
	if view.Parts[0].Title != "赌侠" || view.Parts[2].Place != "功夫 (2004)" || view.Parts[2].Kind != "movie" {
		t.Fatalf("parts -> %+v", view.Parts)
	}
	if root, _ := tm.Films(context.Background(), "/lib", entries); root != nil {
		t.Fatalf("root -> %+v", root)
	}
}

func TestFilmsOfSeriesBesideFilm(t *testing.T) {
	// "星球大战合集/星球大战1 (1999)/": the other films beside it are here, not missing.
	tm := filmsTMDB(t, []tmdbItem{film(1, "星球大战1", "1999-05-19", 7, "星球大战（系列）"), film(2, "星球大战2", "2002-05-16", 7, "星球大战（系列）"),
		film(3, "星球大战3", "2005-05-19", 7, "星球大战（系列）")},
		map[string]int{"星球大战1 (1999)": 1, "星球大战2 (2002)": 2})
	tm.entries[Key("星球大战1 (1999)")].Dir = "/lib/星球大战合集"
	tm.entries[Key("星球大战2 (2002)")].Dir = "/lib/星球大战合集"
	fakeCollection(tm, 7, "星球大战（系列）", 1, 2, 3)
	view, err := tm.Films(context.Background(), "/lib/星球大战合集/星球大战1 (1999)", []RenameEntry{{Name: "星球大战1 (1999).mkv", Size: 9}})
	if err != nil || view == nil || view.Kind != "collection" {
		t.Fatalf("view -> %+v %v", view, err)
	}
	places := map[int]string{}
	for _, p := range view.Parts {
		places[p.ID] = p.Place
	}
	if places[1] != "." || places[2] != "星球大战2 (2002)" || places[3] != "" {
		t.Fatalf("places -> %v", places)
	}
}

// fakeCollection puts a TMDB collection of those films in the cache.
func fakeCollection(tm *TMDB, id int, name string, films ...int) {
	c := &tmdbCollection{ID: id, Name: name}
	for _, f := range films {
		var item tmdbItem
		raw, _ := json.Marshal(fakeOf(tm, f))
		_ = json.Unmarshal(raw, &item)
		c.Parts = append(c.Parts, item)
	}
	collectionMemo.put(strconv.Itoa(id)+"/"+tm.Config().Language, c)
}

func fakeOf(tm *TMDB, id int) tmdbItem {
	return tm.http.Transport.(fakeTMDB)["movie/"+itoa(id)]
}

func TestLookupLeavesOutArtworkAndNotes(t *testing.T) {
	tm := filmsTMDB(t, nil, nil)
	_, pending := tm.Lookup("/lib/Running Man (2010)", []string{"poster.jpg", "tvshow.nfo", "a.ass", "广告.url"})
	if pending != 0 || len(tm.entries) != 0 {
		t.Fatalf("pending %d entries %v", pending, tm.entries)
	}
}
