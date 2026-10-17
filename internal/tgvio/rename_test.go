package tgvio

import "testing"

func TestParseEpisode(t *testing.T) {
	cases := []struct {
		name            string
		season, episode int
	}{
		{"The.Mandalorian.S03E05.2160p.DSNP.WEB-DL.DDP5.1.Atmos.DV.HEVC.mkv", 3, 5},
		{"[SweetSub] Sousou no Frieren - 29 [WebRip 1080p HEVC-10bit AAC].mkv", 0, 29},
		{"[Nekomoe kissaten][Sousou no Frieren][03][1080p][CHS].mp4", 0, 3},
		{"葬送的芙莉莲 第12集.mp4", 0, 12},
		{"爱情公寓 第二季 第十五集.mkv", 2, 15},
		{"EP07.mp4", 0, 7},
		{"07.mkv", 0, 7},
		{"Show 1080p x265 12.mkv", 0, 12},
		{"最后孤屋 (2026).mkv", 0, 0},
		{"Movie.2023.1080p.BluRay.x264.mkv", 0, 0},
	}
	for _, c := range cases {
		s, e := ParseEpisode(c.name)
		if s != c.season || e != c.episode {
			t.Errorf("ParseEpisode(%q) = %d, %d, want %d, %d", c.name, s, e, c.season, c.episode)
		}
	}
}

func TestSafeNameAndNumerals(t *testing.T) {
	if got := SafeName(`星球大战: 曼达洛人 / 古古?`); got != "星球大战： 曼达洛人 古古？" {
		t.Errorf("SafeName = %q", got)
	}
	for n, want := range map[int]string{1: "一", 2: "二", 10: "十", 12: "十二", 20: "二十", 23: "二十三"} {
		if got := cnNumeral(n); got != want {
			t.Errorf("cnNumeral(%d) = %q, want %q", n, got, want)
		}
	}
}

func TestCleanNameTagsOnly(t *testing.T) {
	q, year, _, _ := CleanName("[大话西游][1-2集][1994-1995][国粤双语+简繁特效字幕][42.67GB]")
	if q != "大话西游" || year != 1994 {
		t.Errorf("got %q %d", q, year)
	}
	if q, _, _, _ := CleanName("[周星驰] [原盘电影集 国粤语]"); q != "" {
		t.Errorf("collection folder cleaned to %q", q)
	}
}

func TestMarkConflicts(t *testing.T) {
	plan := &RenamePlan{Items: []RenameItem{
		{Old: "a.mkv", New: "X - S01E01.mkv", Kind: "video"},
		{Old: "b.mkv", New: "X - S01E01.mkv", Kind: "video"},
		{Old: "c.mkv", New: "keep.mkv", Kind: "video"},
	}}
	markConflicts(plan, []RenameEntry{{Name: "a.mkv"}, {Name: "b.mkv"}, {Name: "c.mkv"}, {Name: "keep.mkv"}})
	for _, item := range plan.Items {
		if item.New != "" || item.Reason != "conflict" {
			t.Errorf("%s: want conflict, got %+v", item.Old, item)
		}
	}
}

func TestPlaceEpisode(t *testing.T) {
	frieren := map[int]int{1: 38, 0: 26}
	if s, e := placeEpisode(frieren, 1, 2, 29, false); s != 1 || e != 29 {
		t.Errorf("frieren S2 29 -> S%dE%d", s, e)
	}
	twoSeasons := map[int]int{1: 28, 2: 12}
	if s, e := placeEpisode(twoSeasons, 2, 2, 31, false); s != 2 || e != 3 {
		t.Errorf("absolute 31 -> S%dE%d", s, e)
	}
	if s, e := placeEpisode(twoSeasons, 2, 2, 5, false); s != 2 || e != 5 {
		t.Errorf("S2 5 -> S%dE%d", s, e)
	}
	if s, e := placeEpisode(map[int]int{}, 0, 3, 7, false); s != 3 || e != 7 {
		t.Errorf("no seasons -> S%dE%d", s, e)
	}
	friends := map[int]int{1: 24, 2: 24, 3: 25, 4: 23}
	if s, e := placeEpisode(friends, 4, 4, 24, true); s != 4 || e != 24 {
		t.Errorf("Friends.S04E24 -> S%dE%d", s, e)
	}
}

func TestSubtitleTail(t *testing.T) {
	for name, want := range map[string]string{
		"S05E03.chs.ass":          ".chs.ass",
		"Movie.zh-CN.srt":         ".zh-CN.srt",
		"我们这一天.简体中文.ass":          ".简体中文.ass",
		"我们这一天.第五季.ass":           ".ass",
		"Show.S01E01.WEB-DL.srt":  ".srt",
		"plain.srt":               ".srt",
		"简体中文.srt":                ".简体中文.srt",
		"Show.S01E01.eng.sdh.srt": ".sdh.srt",
	} {
		if got := subtitleTail(name); got != want {
			t.Errorf("subtitleTail(%q) = %q, want %q", name, got, want)
		}
	}
	if n := seasonsWithEpisodes(map[int]int{0: 5, 1: 10, 2: 0, 3: 8}); n != 2 {
		t.Errorf("seasonsWithEpisodes = %d", n)
	}
}

func TestVersionsAndPlaceholders(t *testing.T) {
	if got := versionTag([]string{"a.2160p.mkv", "a.1080p.mkv"}, 1); got != "1080p" {
		t.Errorf("by resolution: %q", got)
	}
	if got := versionTag([]string{"a - 第1集.mkv", "a - 第 1 集.mkv"}, 1); got != "版本2" {
		t.Errorf("by number: %q", got)
	}
	for _, title := range []string{"第 1 集", "第12集", "Episode 3"} {
		if !placeholderTitle.MatchString(title) {
			t.Errorf("%q is a placeholder", title)
		}
	}
	if placeholderTitle.MatchString("瑞秋知道了") {
		t.Error("a real title is no placeholder")
	}
	plan := &RenamePlan{Items: []RenameItem{
		{Old: "big.mkv", New: "X - S01E01.mkv", Kind: "video"},
		{Old: "X - S01E01.mkv", New: "X - S01E01 - 版本2.mkv", Kind: "video"},
	}}
	freeingFirst(plan)
	if plan.Items[0].Old != "X - S01E01.mkv" {
		t.Errorf("the file leaving a name goes first: %+v", plan.Items)
	}
}
