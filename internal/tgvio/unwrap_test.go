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
		{"【更多高清剧集下载请访问 www.BTHDTV.com】【更多剧集打包下载请访问 www.BTHDTV.com】.mkv", 636976, true},
		{"【更多电视剧集下载请访问 www.BTHDTV.com】.MKV", 636976, true},
		{"怪物：杰夫瑞·达莫的故事 - S01E01 - 骗子.mkv", 6939605054, false},
		// One rule for any kind of file: a document, a page, an app, a gif.
		{"【更多无水印蓝光电影请访问 www.BBQDDQ.com】【更多无水印蓝光电影请访问 www.BBQDDQ.com】.DOC", 296080, true},
		{"最新网址发布页.pdf", 2 << 20, true},
		{"扫码关注公众号.gif", 3 << 20, true},
		{"高清电影下载器 www.xx.com.exe", 5 << 20, true},
		{"Thumbs.db", 40 << 10, true},
		{"desktop.ini", 100, true},
		{"马戏之王.torrent", 80 << 10, true},
		// Not ads: a subtitle named after its subtitle site, a film's own artwork and notes.
		{"马戏之王.2017.简体.www.zimuku.cn.srt", 90 << 10, false},
		{"马戏之王 (2017)-fanart.jpg", 3 << 20, false},
		{"马戏之王 (2017).nfo", 4 << 10, false},
		{"马戏之王 (2017).mkv", 10987430613, false},
		// An episode's own files, whatever its title says ("完美的二维码比赛").
		{"Running Man (2010) S01E720.完美的二维码比赛.{tmdbid-33238}-thumb.jpg", 117556, false},
		{"Running Man (2010) S01E720.完美的二维码比赛.{tmdbid-33238}.png", 117556, false},
		{"综艺 第12期 扫码抽奖.jpg", 300 << 10, false},
	} {
		if got := IsJunk(RenameEntry{Name: c.name, Size: c.size}); got != c.junk {
			t.Errorf("IsJunk(%q, %d) = %v", c.name, c.size, got)
		}
	}
}

func TestPlanSeriesAdClipsGoWithoutAskingAPerson(t *testing.T) {
	// "怪物：杰夫瑞·达莫的故事 (2022)/怪物：杰夫瑞·达莫的故事 (2022)/": episodes and two 600 KB ad clips.
	tm := planTMDB(t, nil, nil)
	tm.http.Transport.(fakeTMDB)["tv/88"] = tmdbItem{ID: 88, Name: "怪物：杰夫瑞·达莫的故事", FirstAirDate: "2022-09-21"}
	name := "怪物：杰夫瑞·达莫的故事 (2022)"
	tm.entries[Key(name)] = &Poster{Kind: "tv", ID: 88, Title: "怪物：杰夫瑞·达莫的故事", Year: 2022, Name: name, Rev: cleanerRev}
	ad := "【更多高清剧集下载请访问 www.BTHDTV.com】【更多剧集打包下载请访问 www.BTHDTV.com】.mkv"
	plan, err := tm.PlanRenameIn(context.Background(), "/lib/"+name+"/"+name, []RenameEntry{
		{Name: "怪物：杰夫瑞·达莫的故事 - S01E01 - 骗子.mkv", Size: 6 << 30}, {Name: ad, Size: 636976}}, 0,
		&RenameInherit{Kind: "tv", ID: 88})
	if err != nil {
		t.Fatal(err)
	}
	if got := find(plan, ad); got.Action != "delete" {
		t.Fatalf("ad clip -> %+v", got)
	}
	for _, item := range plan.Items {
		if item.Reason == "no-episode" {
			t.Fatalf("asks a person: %+v", item)
		}
	}
	// The series' folder holding only that folder of its own name opens it up.
	plan, err = tm.PlanRenameIn(context.Background(), "/lib/"+name, []RenameEntry{{Name: name, IsDir: true}}, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := find(plan, name); got.Action != "unwrap" {
		t.Fatalf("same-name folder -> %+v", got)
	}
}

func TestJunkToSweep(t *testing.T) {
	ad := RenameEntry{Name: "【更多无水印蓝光电影请访问 www.BBQDDQ.com】.DOC", Size: 296080}
	film := RenameEntry{Name: "马戏之王 (2017).mkv", Size: 10 << 30}
	// Beside a film: the ad goes.
	if names, whole := JunkToSweep([]RenameEntry{film, ad}); len(names) != 1 || whole {
		t.Fatalf("beside a film -> %v %v", names, whole)
	}
	// Beside nothing big (a folder of notes and pictures): nothing is guessed away.
	if names, _ := JunkToSweep([]RenameEntry{{Name: "说明.docx", Size: 30 << 10}, ad}); names != nil {
		t.Fatalf("no film -> %v", names)
	}
	// A folder of nothing but ads goes whole.
	txt := RenameEntry{Name: "Torrent Downloaded From Thepiratebay.org.txt", Size: 49}
	if names, whole := JunkToSweep([]RenameEntry{txt, {Name: "RARBG.txt", Size: 31}}); len(names) != 2 || !whole {
		t.Fatalf("only ads -> %v %v", names, whole)
	}
	// An episode's thumbnail beside its video stays.
	thumb := RenameEntry{Name: "Running Man (2010) S01E720.完美的二维码比赛.{tmdbid-33238}-thumb.jpg", Size: 117556}
	if names, _ := JunkToSweep([]RenameEntry{film, thumb}); names != nil {
		t.Fatalf("thumbnail -> %v", names)
	}
}
