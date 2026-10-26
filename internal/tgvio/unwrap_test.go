package tgvio

import (
	"context"
	"testing"
)

func TestPlanUnwrapsSeriesReleaseFolder(t *testing.T) {
	// "怪物：艾德·盖恩的故事 (2025)/【高清剧集网发布 www.BBHDTV.com】…[全8集]…/": the release opens up into the series' folder.
	tm := planTMDB(t, nil, nil)
	tm.http.Transport.(fakeTMDB)["tv/77"] = tmdbItem{ID: 77, Name: "怪物：艾德·盖恩的故事", FirstAirDate: "2025-10-03"}
	tm.entries[Key("怪物：艾德·盖恩的故事 (2025)")] = &Poster{Kind: "tv", ID: 77, Title: "怪物：艾德·盖恩的故事", Year: 2025, Name: "怪物：艾德·盖恩的故事 (2025)", Rev: cleanerRev}
	release := "【高清剧集网发布 www.BBHDTV.com】怪物：艾德·盖恩的故事[全8集][简繁英字幕].2160p.NF.WEB-DL.DDP.5.1.Atmos.HDR10.H.265-BlackTV"
	plan, err := tm.PlanRenameIn(context.Background(), "/lib/怪物：艾德·盖恩的故事 (2025)", []RenameEntry{{Name: release, IsDir: true}}, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := find(plan, release); got.Action != "unwrap" {
		t.Fatalf("release folder -> %+v (plan %+v)", got, plan)
	}
	// A season's folder stays: a series keeps its seasons apart.
	plan, err = tm.PlanRenameIn(context.Background(), "/lib/怪物：艾德·盖恩的故事 (2025)", []RenameEntry{{Name: "怪物：艾德·盖恩的故事 第一季 (2025)", IsDir: true}}, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := find(plan, "怪物：艾德·盖恩的故事 第一季 (2025)"); got.Action == "unwrap" {
		t.Fatalf("season folder unwrapped: %+v", got)
	}
}

func TestIsJunkKnowsSiteAds(t *testing.T) {
	for _, c := range []struct {
		name string
		size int64
		junk bool
	}{
		{"更多电视剧集下载请访问 高清剧集网官网（www.DDHDTV.com）.png", 1193738, true},
		{"更多电视剧集下载请访问 高清剧集网官网（www.BPHDTV.com）.png", 1947182, true},
		{"官方Telegram交流群@bde4_com.url", 200, true},
		{"最新地址发布页.txt", 300 << 10, true},
		{"poster.jpg", 900 << 10, false},
		{"怪物：艾德·盖恩的故事 - S01E01 - 妈妈！-thumb.jpg", 200 << 10, false},
		{"说明.txt", 300 << 10, false},
		{"www.site.com 一部很长的电影.mkv", 2 << 30, false},
	} {
		if got := IsJunk(RenameEntry{Name: c.name, Size: c.size}); got != c.junk {
			t.Errorf("IsJunk(%q, %d) = %v", c.name, c.size, got)
		}
	}
}
