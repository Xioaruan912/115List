package tgvio

import "testing"

func TestCleanName(t *testing.T) {
	cases := []struct {
		in, query  string
		year, tmdb int
		imdb       string
	}{
		{"爱情公寓", "爱情公寓", 0, 0, ""},
		{"东京喰种 (2014)", "东京喰种", 2014, 0, ""},
		{"后室 (2026) {tmdb-1083381}", "后室", 2026, 1083381, ""},
		{"[大话西游之月光宝盒 A Chinese Odyssey Part1 1994][豆瓣电影评分9.0][MT-311364][tt0112778][20.27GB].iso", "大话西游之月光宝盒 A Chinese Odyssey Part1", 1994, 0, "tt0112778"},
		{"Chainsaw.Man.The.Movie.Reze.Arc.2025.2160p.MA.WEB-DL.mkv", "Chainsaw Man The Movie Reze Arc", 2025, 0, ""},
		{"01.mp4", "", 0, 0, ""},
		{"[周星驰] [原盘电影集 国粤语]", "", 0, 0, ""},
		{"黑袍纠察队 (2019)", "黑袍纠察队", 2019, 0, ""},
		{"葬送的芙莉莲 第二季", "葬送的芙莉莲", 0, 0, ""},
		{"蜘蛛侠系列 (三部曲)", "蜘蛛侠", 0, 0, ""},
		{"Running Man (2010)", "Running Man", 2010, 0, ""},
		{"The.Last.of.Us.S02.2160p.WEB-DL", "The Last of Us", 0, 0, ""},
	}
	for _, c := range cases {
		query, year, tmdb, imdb := CleanName(c.in)
		if query != c.query || year != c.year || tmdb != c.tmdb || imdb != c.imdb {
			t.Errorf("CleanName(%q) = %q %d %d %q, want %q %d %d %q", c.in, query, year, tmdb, imdb, c.query, c.year, c.tmdb, c.imdb)
		}
	}
}

func TestSeasonAndSkip(t *testing.T) {
	seasons := map[string]int{"第一季": 1, "第二季": 2, "第十二季": 12, "Season 01": 1, "season 3": 3, "S02": 2, "葬送的芙莉莲 第二季": 2, "爱情公寓": 0, "The.Last.of.Us.S02.2160p": 2, "阿凡达2009": 0}
	for name, want := range seasons {
		if got := SeasonOf(name); got != want {
			t.Errorf("SeasonOf(%q) = %d, want %d", name, got, want)
		}
	}
	skips := map[string]bool{"Off.Campus.S01E01.2160p.AMZN.WEB-DL.mkv": true, "frieren.beyond.journeys.end.s02e01.shall.we.go.mkv": true, "miaa-354.mp4": true,
		"www.98t.la@snos-309_restored.mp4": true, "ipzz-814【非常好看】": true, "第03集.mp4": true, "爱情公寓": false, "Avatar.2009.1080p.BluRay.x264.mkv": false, "东京喰种 (2014)": false}
	for name, want := range skips {
		if got := Skip(name); got != want {
			t.Errorf("Skip(%q) = %v, want %v", name, got, want)
		}
	}
}

func TestCleanPaths(t *testing.T) {
	got := CleanPaths([]string{" /115/我要看/ ", "/115/我要看/剧集", "115/读书", "", "/115/读书"})
	if len(got) != 2 || got[0] != "/115/我要看" || got[1] != "/115/读书" {
		t.Fatalf("CleanPaths = %v", got)
	}
	if got := CleanPaths([]string{"/", "/a"}); len(got) != 1 || got[0] != "/" {
		t.Fatalf("root swallows the rest: %v", got)
	}
}

func TestCategoryOf(t *testing.T) {
	cases := []struct {
		kind   string
		genres []int
		want   string
	}{
		{"movie", []int{28, 12}, "movie"},
		{"tv", []int{18}, "tv"},
		{"tv", []int{16, 10759}, "anime"},
		{"movie", []int{16, 10751}, "anime"},
		{"tv", []int{10764}, "variety"},
		{"tv", []int{10767, 35}, "variety"},
		{"movie", []int{99}, "documentary"},
		{"tv", []int{99}, "documentary"},
	}
	for _, c := range cases {
		if got := CategoryOf(c.kind, c.genres); got != c.want {
			t.Errorf("CategoryOf(%s, %v) = %s, want %s", c.kind, c.genres, got, c.want)
		}
	}
}

func TestCleanNameDiscs(t *testing.T) {
	for name, want := range map[string]string{
		"生化危机4 3D.iso":      "生化危机4",
		"新哥斯拉20164K.iso":    "新哥斯拉",
		"暮光之城4上.iso":        "暮光之城4 上",
		"哈利·波特与死亡圣器(下).iso": "哈利 波特与死亡圣器 下",
		"天下.mkv":            "天下",
		"一路向下 (2020).mkv":   "一路向下",
	} {
		if got, _, _, _ := CleanName(name); got != want {
			t.Errorf("CleanName(%q) = %q, want %q", name, got, want)
		}
	}
	if !agrees("暮光之城4 上", "暮光之城4：破晓（上）") || agrees("暮光之城4 上", "暮光之城4：破晓（下）") {
		t.Error("halves")
	}
}

func TestAgreesByWords(t *testing.T) {
	for _, c := range []struct {
		q, title string
		want     bool
	}{
		{"霍比特人 五军之战", "霍比特人3：五军之战", true},
		{"星球大战前传1 幽灵的威胁", "星球大战1：幽灵的威胁", true},
		{"游侠索罗 星球大战外传", "星球大战外传2：游侠索罗", true},
		{"霍比特人 五军之战", "指环王：王者无敌", false},
		{"蝙蝠侠 黑暗骑士", "黑暗骑士崛起", false},
		{"指环王 双塔奇兵1", "指环王2：双塔奇兵", true},
		{"指环王 魔戒再现1", "指环王1：魔戒再现", true},
	} {
		if got := agrees(c.q, c.title); got != c.want {
			t.Errorf("agrees(%q, %q) = %v", c.q, c.title, got)
		}
	}
}
