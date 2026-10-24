package tgvio

import (
	"context"
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
