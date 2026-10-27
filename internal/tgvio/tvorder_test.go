package tgvio

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// rawTMDB answers TMDB paths with fixed JSON (anything else: nothing found).
type rawTMDB map[string]string

func (f rawTMDB) RoundTrip(r *http.Request) (*http.Response, error) {
	rec := httptest.NewRecorder()
	if body, ok := f[strings.TrimPrefix(r.URL.Path, "/3/")]; ok {
		_, _ = io.WriteString(rec, body)
	} else {
		_, _ = io.WriteString(rec, `{"results":[]}`)
	}
	return rec.Result(), nil
}

func TestSeasonsFromEpisodeGroup(t *testing.T) {
	// 葬送的芙莉莲: one season of 38 on TMDB; its "Seasons" group has Season 2 = episodes 29–38.
	tm := planTMDB(t, nil, nil)
	var eps []string
	for i := 1; i <= 28; i++ {
		eps = append(eps, fmt.Sprintf(`{"episode_number":%d,"name":"第一季 %d","air_date":"2023-10-01","order":%d}`, i, i, i-1))
	}
	season1 := strings.Join(eps, ",")
	tm.http.Transport = rawTMDB{
		"tv/1": `{"id":1,"name":"葬送的芙莉莲","first_air_date":"2023-09-29","seasons":[
			{"season_number":0,"name":"特别篇","episode_count":26,"air_date":"2023-10-11"},
			{"season_number":1,"name":"第 1 季","episode_count":38,"air_date":"2023-09-29","poster_path":"/s1.jpg"}]}`,
		"tv/1/episode_groups": `{"results":[{"id":"g","type":6,"name":"Seasons","group_count":3}]}`,
		"tv/episode_group/g": `{"groups":[
			{"name":"Season 1","order":1,"episodes":[` + season1 + `]},
			{"name":"Specials","order":0,"episodes":[{"episode_number":1,"name":"迷你动画","order":0}]},
			{"name":"Season 2","order":2,"episodes":[
				{"episode_number":29,"name":"那，走吧","still_path":"/e29.jpg","air_date":"2026-01-16","order":0},
				{"episode_number":30,"name":"南之勇者","still_path":"/e30.jpg","air_date":"2026-01-23","order":1}]}]}`,
	}
	folder := "葬送的芙莉莲 第二季 (2023)"
	tm.entries[Key(folder)] = &Poster{Kind: "tv", ID: 1, Title: "葬送的芙莉莲", Year: 2023, Name: folder, Season: 2, Rev: cleanerRev}
	seasons, err := tm.Seasons(context.Background(), 1)
	if err != nil || len(seasons) != 3 || seasons[1].Season != 2 || seasons[1].Episodes != 2 || seasons[0].Episodes != 28 || seasons[1].Year != 2026 {
		t.Fatalf("seasons -> %+v %v", seasons, err)
	}
	if st := tm.episodes(context.Background(), 1, 2).stills[1]; st != "/e29.jpg" {
		t.Fatalf("season 2 episode 1 still -> %q", st)
	}
	plan, err := tm.PlanRenameIn(context.Background(), "/lib/"+folder, []RenameEntry{
		{Name: "[SweetSub] Sousou no Frieren - 29 [WebRip 1080p HEVC-10bit AAC].mkv", Size: 1 << 30},
		{Name: "[SweetSub] Sousou no Frieren - 30 [WebRip 1080p HEVC-10bit AAC].mkv", Size: 1 << 30}}, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := find(plan, "[SweetSub] Sousou no Frieren - 29 [WebRip 1080p HEVC-10bit AAC].mkv").New; got != "葬送的芙莉莲 - S02E01 - 那，走吧.mkv" {
		t.Fatalf("episode 29 -> %q", got)
	}
	if got := find(plan, "[SweetSub] Sousou no Frieren - 30 [WebRip 1080p HEVC-10bit AAC].mkv").New; got != "葬送的芙莉莲 - S02E02 - 南之勇者.mkv" {
		t.Fatalf("episode 30 -> %q", got)
	}
}

func TestAnthologySeasonIsTheOnlySeason(t *testing.T) {
	// "Monster.2022.S02E01": 怪物：梅内德斯兄弟的故事 has one season of 9 on TMDB.
	tm := planTMDB(t, nil, nil)
	tm.http.Transport = rawTMDB{
		"tv/2": `{"id":2,"name":"怪物：梅内德斯兄弟的故事","first_air_date":"2024-09-19","seasons":[
			{"season_number":1,"name":"第 1 季","episode_count":9,"air_date":"2024-09-19"}]}`,
		"tv/2/season/1": `{"episodes":[{"episode_number":1,"name":"都是下雨的错"},{"episode_number":2,"name":"挥金如土"}]}`,
	}
	root := "怪物：梅内德斯兄弟的故事 (2024)"
	tm.entries[Key(root)] = &Poster{Kind: "tv", ID: 2, Title: "怪物：梅内德斯兄弟的故事", Year: 2024, Name: root, Rev: cleanerRev}
	release := "怪物：梅内德斯兄弟的故事 第二季.6v电影 地址发布页 www.6v123.com 收藏不迷路"
	plan, err := tm.PlanRenameIn(context.Background(), "/lib/"+root+"/"+release, []RenameEntry{
		{Name: "怪物：梅内德斯兄弟的故事.Monster.2022.S02E01.Blame.It.on.the.Rain.1080p.HD中字[电影港www.dygangs.me].mp4", Size: 1 << 30},
		{Name: "怪物：梅内德斯兄弟的故事.Monster.2022.S02E02.Spree.1080p.HD中字[电影港www.dygangs.me].mp4", Size: 1 << 30}}, 0,
		&RenameInherit{Kind: "tv", ID: 2})
	if err != nil {
		t.Fatal(err)
	}
	if got := find(plan, "怪物：梅内德斯兄弟的故事.Monster.2022.S02E02.Spree.1080p.HD中字[电影港www.dygangs.me].mp4").New; got != "怪物：梅内德斯兄弟的故事 - S01E02 - 挥金如土.mp4" {
		t.Fatalf("S02E02 -> %q (plan %+v)", got, plan.Items)
	}
	for _, item := range plan.Items {
		if item.Kind == "folder" && strings.Contains(item.New, "第二季") {
			t.Fatalf("folder -> %q", item.New)
		}
	}
}

func TestTreeOfSeasons(t *testing.T) {
	tm := filmsTMDB(t, nil, nil)
	var eps []string
	for i := 1; i <= 28; i++ {
		eps = append(eps, fmt.Sprintf(`{"episode_number":%d,"name":"第一季 %d","air_date":"2023-10-01","order":%d}`, i, i, i-1))
	}
	tm.http.Transport = rawTMDB{
		// 怪物：梅内德斯兄弟的故事: one season.
		"tv/2": `{"id":2,"name":"怪物：梅内德斯兄弟的故事","first_air_date":"2024-09-19","seasons":[{"season_number":1,"episode_count":9,"air_date":"2024-09-19"}]}`,
		"tv/2/season/1": `{"episodes":[{"episode_number":1,"name":"都是下雨的错"}]}`,
		// 葬送的芙莉莲: two seasons by its episode group.
		"tv/1": `{"id":1,"name":"葬送的芙莉莲","first_air_date":"2023-09-29","seasons":[{"season_number":1,"episode_count":38,"air_date":"2023-09-29"}]}`,
		"tv/1/episode_groups": `{"results":[{"id":"g","type":6,"name":"Seasons","group_count":2}]}`,
		"tv/episode_group/g": `{"groups":[{"name":"Season 1","order":1,"episodes":[` + strings.Join(eps, ",") + `]},
			{"name":"Season 2","order":2,"episodes":[{"episode_number":29,"name":"那，走吧","air_date":"2026-01-16","order":0}]}]}`,
	}
	ctx := context.Background()

	// One season: the series' folder holding its season's folder opens it up.
	root := "怪物：梅内德斯兄弟的故事 (2024)"
	tm.entries[Key(root)] = &Poster{Kind: "tv", ID: 2, Title: "怪物：梅内德斯兄弟的故事", Year: 2024, Name: root, Rev: cleanerRev}
	inner := "怪物：梅内德斯兄弟的故事 第二季 (2024)"
	plan, err := tm.PlanRenameIn(ctx, "/lib/"+root, []RenameEntry{{Name: inner, IsDir: true}}, 0, nil)
	if err != nil || find(plan, inner).Action != "unwrap" {
		t.Fatalf("one season's folder -> %+v %v", find(plan, inner), err)
	}

	// Several seasons: a season's folder in the library goes into the series' folder.
	loose := "葬送的芙莉莲 第二季 (2023)"
	tm.entries[Key(loose)] = &Poster{Kind: "tv", ID: 1, Title: "葬送的芙莉莲", Year: 2023, Name: loose, Season: 2, Rev: cleanerRev}
	plan, err = tm.PlanRenameIn(ctx, "/lib/"+loose, []RenameEntry{{Name: "[SweetSub] Sousou no Frieren - 29.mkv", Size: 1 << 30}}, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := find(plan, loose).New; got != "葬送的芙莉莲 (2023)/葬送的芙莉莲 第二季 (2026)" {
		t.Fatalf("loose season -> %q", got)
	}

	// One season lying in the library as "第一季": it is the series' folder.
	solo := "怪物：梅内德斯兄弟的故事 第一季 (2024)"
	tm.entries[Key(solo)] = &Poster{Kind: "tv", ID: 2, Title: "怪物：梅内德斯兄弟的故事", Year: 2024, Name: solo, Season: 1, Rev: cleanerRev}
	plan, err = tm.PlanRenameIn(ctx, "/lib/"+solo, []RenameEntry{{Name: "Monster.S01E01.mkv", Size: 1 << 30}}, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := find(plan, solo).New; got != "怪物：梅内德斯兄弟的故事 (2024)" {
		t.Fatalf("solo season -> %q", got)
	}
}

func TestSeasonInsideSameSeasonOpensUp(t *testing.T) {
	// "葬送的芙莉莲 (2023)/葬送的芙莉莲 第一季 (2023)/葬送的芙莉莲 第一季 (2023)/…": the inner one opens up.
	tm := filmsTMDB(t, nil, nil)
	tm.http.Transport = rawTMDB{
		"tv/1": `{"id":1,"name":"葬送的芙莉莲","first_air_date":"2023-09-29","seasons":[{"season_number":1,"episode_count":28,"air_date":"2023-09-29"},{"season_number":2,"episode_count":10,"air_date":"2026-01-16"}]}`,
	}
	box := "葬送的芙莉莲 (2023)"
	tm.entries[Key(box)] = &Poster{Kind: "tv", ID: 1, Title: "葬送的芙莉莲", Year: 2023, Name: box, Rev: cleanerRev}
	season := "葬送的芙莉莲 第一季 (2023)"
	plan, err := tm.PlanRenameIn(context.Background(), "/lib/"+box+"/"+season, []RenameEntry{{Name: season, IsDir: true}}, 0,
		&RenameInherit{Kind: "tv", ID: 1})
	if err != nil || find(plan, season).Action != "unwrap" {
		t.Fatalf("season in season -> %+v %v", find(plan, season), err)
	}
	// Another season's folder inside is no wrapping.
	plan, _ = tm.PlanRenameIn(context.Background(), "/lib/"+box+"/"+season, []RenameEntry{{Name: "葬送的芙莉莲 第二季 (2026)", IsDir: true}}, 0,
		&RenameInherit{Kind: "tv", ID: 1})
	if find(plan, "葬送的芙莉莲 第二季 (2026)").Action == "unwrap" {
		t.Fatal("another season unwrapped")
	}
}

func TestSeasonFolderIsItsSeriesSeason(t *testing.T) {
	// "亢奋 (2019)/亢奋 第三季 (2026)": 亢奋's third season, even with a record of another series from an older search.
	tm := filmsTMDB(t, nil, nil)
	tm.http.Transport = rawTMDB{
		"tv/85552/season/3": `{"season_number":3,"name":"第 3 季","poster_path":"/s3.jpg","air_date":"2026-04-12"}`,
	}
	tm.entries[Key("亢奋 (2019)")] = &Poster{Kind: "tv", ID: 85552, Title: "亢奋", Year: 2019, Name: "亢奋 (2019)", Dir: "/lib", Rev: cleanerRev}
	tm.entries[Key("亢奋 第三季 (2026)")] = &Poster{Kind: "tv", ID: 999, Title: "Euphoria (another)", Year: 2026, Name: "亢奋 第三季 (2026)", Dir: "/lib/亢奋 (2019)", Rev: cleanerRev}
	p, err := tm.resolve(context.Background(), "亢奋 第三季 (2026)", "/lib/亢奋 (2019)")
	if err != nil || p.ID != 85552 || p.Season != 3 || p.Poster != "/s3.jpg" {
		t.Fatalf("season folder -> %+v %v", p, err)
	}
	// A choice made by hand stays.
	tm.entries[Key("亢奋 第三季 (2026)")] = &Poster{Kind: "tv", ID: 999, Name: "亢奋 第三季 (2026)", Dir: "/lib/亢奋 (2019)", Manual: true}
	if p, _ := tm.resolve(context.Background(), "亢奋 第三季 (2026)", "/lib/亢奋 (2019)"); p.ID != 999 {
		t.Fatalf("manual -> %+v", p)
	}
}
