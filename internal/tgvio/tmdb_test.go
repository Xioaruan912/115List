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
		{"[大话西游之月光宝盒 A Chinese Odyssey Part1 1994][豆瓣电影评分9.0][MT-311364][tt0112778][20.27GB].iso", "", 1994, 0, "tt0112778"},
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
