package tgvio

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"golang.org/x/time/rate"
)

// fakeTMDB answers film details from films (by id) and finds nothing in searches.
type fakeTMDB map[string]tmdbItem

func (f fakeTMDB) RoundTrip(r *http.Request) (*http.Response, error) {
	rec := httptest.NewRecorder()
	path := strings.TrimPrefix(r.URL.Path, "/3/")
	if item, ok := f[path]; ok {
		_ = json.NewEncoder(rec).Encode(item)
	} else {
		_, _ = io.WriteString(rec, `{"results":[]}`)
	}
	return rec.Result(), nil
}

func film(id int, title, date string, collection int, collectionName string) tmdbItem {
	item := tmdbItem{ID: id, Title: title, ReleaseDate: date}
	if collection > 0 {
		item.BelongsToCollection = &struct {
			ID   int    `json:"id"`
			Name string `json:"name"`
		}{collection, collectionName}
	}
	return item
}

func planTMDB(t *testing.T, films []tmdbItem, names map[string]int) *TMDB {
	detailsCache.Range(func(k, _ any) bool { detailsCache.Delete(k); return true }) // ids mean other films in each test
	fake := fakeTMDB{}
	byID := map[int]tmdbItem{}
	for _, f := range films {
		fake["movie/"+itoa(f.ID)] = f
		byID[f.ID] = f
	}
	tm := &TMDB{dir: t.TempDir(), token: "x", http: &http.Client{Transport: fake}, limiter: rate.NewLimiter(rate.Inf, 1),
		entries: map[string]*Poster{}, queue: make(chan lookupJob, 16), queued: map[string]bool{},
		enrich: make(chan [2]string, 16), enriched: map[string]bool{}}
	for name, id := range names {
		p := byID[id].poster("movie")
		p.Name = name
		tm.entries[Key(name)] = p
	}
	return tm
}

func itoa(n int) string { b, _ := json.Marshal(n); return string(b) }

func find(plan *RenamePlan, old string) RenameItem {
	for _, item := range plan.Items {
		if item.Old == old {
			return item
		}
	}
	return RenameItem{}
}

const conjuring = "招魂（系列）"

func TestPlanReleaseFolderInsideFilmOfSeries(t *testing.T) {
	// 潜伏 (2011)/潜伏3 (2015)/[DBD-Raws][潜伏3]…/ is 潜伏3, not the series' first film.
	tm := planTMDB(t, []tmdbItem{film(1, "潜伏", "2011-01-01", 9, ""), film(3, "潜伏3", "2015-01-01", 9, "")},
		map[string]int{"潜伏 (2011)": 1, "潜伏3 (2015)": 3})
	dir := "/lib/潜伏 (2011)/潜伏3 (2015)/[DBD-Raws][潜伏3][1080P][BDRip][HEVC-10bit][中英外挂][FLAC][MKV]"
	plan, err := tm.PlanRenameIn(context.Background(), dir, []RenameEntry{{Name: "潜伏 (2011).mkv"}, {Name: "潜伏 (2011).ass"}}, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := find(plan, "潜伏 (2011).mkv").New; got != "潜伏3 (2015).mkv" {
		t.Fatalf("video -> %q", got)
	}
	if got := find(plan, "潜伏 (2011).ass").New; got != "潜伏3 (2015).ass" {
		t.Fatalf("subtitle -> %q", got)
	}
}

func TestPlanReleaseFolderFindingFirstFilm(t *testing.T) {
	// The folder's own lookup found 潜伏 (2011); the folder above is 潜伏3, and its name says so.
	dbd := "[DBD-Raws][潜伏3][1080P][BDRip][HEVC-10bit][中英外挂][FLAC][MKV]"
	tm := planTMDB(t, []tmdbItem{film(1, "潜伏", "2011-01-01", 9, ""), film(3, "潜伏3", "2015-01-01", 9, "")},
		map[string]int{dbd: 1, "潜伏3 (2015)": 3})
	plan, err := tm.PlanRenameIn(context.Background(), "/lib/潜伏 (2011)/潜伏3 (2015)/"+dbd, []RenameEntry{{Name: "潜伏 (2011).mkv"}}, 0,
		&RenameInherit{Kind: "movie", ID: 3, Film: true})
	if err != nil {
		t.Fatal(err)
	}
	if got := find(plan, "潜伏 (2011).mkv").New; got != "潜伏3 (2015).mkv" {
		t.Fatalf("video -> %q", got)
	}
	// ... and the folder above opens it up although its name found the first film.
	plan, err = tm.PlanRenameIn(context.Background(), "/lib/潜伏 (2011)/潜伏3 (2015)", []RenameEntry{{Name: dbd, IsDir: true}}, 0,
		&RenameInherit{Kind: "movie", ID: 1})
	if err != nil {
		t.Fatal(err)
	}
	if got := find(plan, dbd); got.Action != "unwrap" {
		t.Fatalf("release folder -> %+v (subject %+v)", got, plan.Subject)
	}
	// The other way round, a sequel's folder in the series' folder keeps its own film.
	tm = planTMDB(t, []tmdbItem{film(1, "潜伏", "2011-01-01", 9, ""), film(3, "潜伏3", "2015-01-01", 9, "")},
		map[string]int{"潜伏3 (2015)": 3})
	plan, err = tm.PlanRenameIn(context.Background(), "/lib/潜伏 (2011)/潜伏3 (2015)", []RenameEntry{{Name: "x.mkv"}}, 0,
		&RenameInherit{Kind: "movie", ID: 1})
	if err != nil {
		t.Fatal(err)
	}
	if plan.Subject == nil || plan.Subject.ID != 3 {
		t.Fatalf("subject -> %+v", plan.Subject)
	}
}

func TestPlanBelowShelfInheritsNothing(t *testing.T) {
	// 蜘蛛侠 (2002) is a shelf: a film below it found nothing of its own and stays so.
	tm := planTMDB(t, []tmdbItem{film(1, "蜘蛛侠", "2002-05-01", 1, "")}, nil)
	plan, err := tm.PlanRenameIn(context.Background(), "/lib/蜘蛛侠 (2002)/原盘ISO/蜘蛛侠：英雄无归 (2021)",
		[]RenameEntry{{Name: "Spider-Man No Way Home (2021).iso"}}, 0, &RenameInherit{Kind: "movie", ID: 1})
	if err != nil {
		t.Fatal(err)
	}
	if plan.Reason != "no-match" {
		t.Fatalf("plan -> %+v", plan)
	}
	// Below one film's folder, a release folder named like another film is still that film.
	tm = planTMDB(t, []tmdbItem{film(1, "潜伏", "2011-01-01", 9, ""), film(2, "潜伏2", "2013-01-01", 9, "")},
		map[string]int{"q伏2.2013.BD1080p.中英双字.mp4": 1})
	plan, err = tm.PlanRenameIn(context.Background(), "/lib/潜伏/潜伏2 (2013)/q伏2.2013.BD1080p.中英双字.mp4",
		[]RenameEntry{{Name: "潜伏 (2011).mp4"}}, 0, &RenameInherit{Kind: "movie", ID: 2, Film: true})
	if err != nil {
		t.Fatal(err)
	}
	if got := find(plan, "潜伏 (2011).mp4").New; got != "潜伏2 (2013).mp4" {
		t.Fatalf("video -> %q", got)
	}
	// ... and 潜伏2 (2013) opens it up, although its name found 潜伏.
	tm = planTMDB(t, []tmdbItem{film(1, "潜伏", "2011-01-01", 9, ""), film(2, "潜伏2", "2013-01-01", 9, "")},
		map[string]int{"q伏2.2013.BD1080p.中英双字.mp4": 1, "潜伏2 (2013)": 2})
	plan, err = tm.PlanRenameIn(context.Background(), "/lib/潜伏/潜伏2 (2013)",
		[]RenameEntry{{Name: "q伏2.2013.BD1080p.中英双字.mp4", IsDir: true}}, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := find(plan, "q伏2.2013.BD1080p.中英双字.mp4"); got.Action != "unwrap" {
		t.Fatalf("wrapper -> %+v", got)
	}
}

func TestPlanSeriesFolderKeepsSeriesName(t *testing.T) {
	tm := planTMDB(t, []tmdbItem{film(1, "招魂", "2013-07-18", 100, conjuring), film(3, "招魂3", "2021-06-02", 100, conjuring),
		film(4, "招魂4：终章", "2025-09-03", 100, conjuring)},
		map[string]int{"招魂 (2013)": 1, "招魂 (2013).mkv": 1, "招魂4：终章 (2025).mkv": 4, "招魂3 (2021)": 3})
	plan, err := tm.PlanRenameIn(context.Background(), "/lib/招魂 (2013)", []RenameEntry{
		{Name: "招魂 (2013).mkv"}, {Name: "招魂4：终章 (2025).mkv"}, {Name: "招魂3 (2021)", IsDir: true}}, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := find(plan, "招魂 (2013)"); got.New != "招魂" {
		t.Fatalf("folder -> %+v", got)
	}
	// One film and its sequel in a folder: also the series, not the first film.
	plan, err = tm.PlanRenameIn(context.Background(), "/lib/招魂 (2013)", []RenameEntry{
		{Name: "招魂 (2013).mkv"}, {Name: "招魂3 (2021)", IsDir: true}}, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := find(plan, "招魂 (2013)"); got.New != "招魂" {
		t.Fatalf("folder with a sequel folder -> %+v", got)
	}
}

func TestPlanShelfOfFoldersKeepsName(t *testing.T) {
	// Only folders, of films of different series: a shelf, named by its owner.
	tm := planTMDB(t, []tmdbItem{film(1, "蜘蛛侠", "2002-05-01", 1, "蜘蛛侠（系列）"), film(2, "超凡蜘蛛侠", "2012-07-03", 2, "超凡蜘蛛侠（系列）")},
		map[string]int{"蜘蛛侠 (2002)": 1, "超凡蜘蛛侠 (2012)": 2})
	plan, err := tm.PlanRenameIn(context.Background(), "/lib/蜘蛛侠 (2002)", []RenameEntry{
		{Name: "原盘ISO", IsDir: true}, {Name: "蜘蛛侠 (2002)", IsDir: true}, {Name: "超凡蜘蛛侠 (2012)", IsDir: true}}, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := find(plan, "蜘蛛侠 (2002)"); got.Kind != "folder" || got.New != "" || got.Reason != "several" {
		t.Fatalf("shelf folder -> %+v", got)
	}
}

func TestPlanUnwrapAndJunk(t *testing.T) {
	tm := planTMDB(t, []tmdbItem{film(7, "瘴气营地的青春性事与死亡", "2026-01-01", 0, "")},
		map[string]int{"瘴气营地的青春性事与死亡 (2026)": 7})
	wrapper := "瘴气营地的青春性事与死亡.6v电影 地址发布页 www.6v123.net 收藏不迷路"
	plan, err := tm.PlanRenameIn(context.Background(), "/lib/瘴气营地的青春性事与死亡 (2026)", []RenameEntry{
		{Name: wrapper, IsDir: true}, {Name: "6v电影 地址发布页 www.6v123.net 收藏不迷路.txt", Size: 300},
		{Name: ".a.mkv.baiduyun.uploading.cfg", Size: 900}}, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := find(plan, wrapper); got.Action != "unwrap" {
		t.Fatalf("wrapper -> %+v", got)
	}
	if got := find(plan, "6v电影 地址发布页 www.6v123.net 收藏不迷路.txt"); got.Action != "delete" {
		t.Fatalf("ad -> %+v", got)
	}
	if got := find(plan, ".a.mkv.baiduyun.uploading.cfg"); got.Action != "delete" {
		t.Fatalf("leftover -> %+v", got)
	}
	// A folder of another film is no wrapper.
	tm = planTMDB(t, []tmdbItem{film(1, "招魂", "2013-07-18", 100, conjuring), film(3, "招魂3", "2021-06-02", 100, conjuring)},
		map[string]int{"招魂": 1, "招魂3 (2021)": 3})
	plan, err = tm.PlanRenameIn(context.Background(), "/lib/招魂", []RenameEntry{{Name: "招魂3 (2021)", IsDir: true}}, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := find(plan, "招魂3 (2021)"); got.Action != "" {
		t.Fatalf("other film's folder -> %+v", got)
	}
}

func TestIsJunkAndSeriesFolder(t *testing.T) {
	for _, c := range []struct {
		e    RenameEntry
		junk bool
	}{
		{RenameEntry{Name: "PSArips.com.txt", Size: 120}, true},
		{RenameEntry{Name: "访问网址.url", Size: 80}, true},
		{RenameEntry{Name: "_____padding_file_0_如果您看到此文件", Size: 5 << 20}, true},
		{RenameEntry{Name: "剧本.txt", Size: 200 << 10}, false},
		{RenameEntry{Name: "潜伏.mkv", Size: 100}, false},
		{RenameEntry{Name: "notes.txt", IsDir: true}, false},
	} {
		if got := IsJunk(c.e); got != c.junk {
			t.Errorf("IsJunk(%q) = %v", c.e.Name, got)
		}
	}
	if got := seriesFolder([]string{"招魂", "招魂2", "招魂3"}, conjuring); got != "招魂" {
		t.Errorf("series = %q", got)
	}
	if got := seriesFolder([]string{"复仇者联盟", "复仇者联盟2：奥创纪元"}, ""); got != "复仇者联盟" {
		t.Errorf("series = %q", got)
	}
	if got := seriesFolder([]string{"蜘蛛侠", "超凡蜘蛛侠"}, "蜘蛛侠（系列）"); got != "蜘蛛侠" {
		t.Errorf("series from collection = %q", got)
	}
}
