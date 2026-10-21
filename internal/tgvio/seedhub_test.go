package tgvio

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Pages shaped like SeedHub's: a search result, a title with two seeds, a seed page.
const (
	hubSearch = `<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script><div class="cover-container"><div class="cover">
<a title="潜伏 Lurk" class="image" href="/movies/8009/"><img src="https://img.example/p.jpg"></a>
<ul><li><h2><a href="/movies/8009/" class="header-anchor">#</a> 潜伏</h2></li>
<li>2009 / 剧集 / 中国大陆 / 汉语普通话 / 孙红雷</li><li>豆瓣评分: <a href="#">9.1</a></li></ul></div></div>`
	hubTitle = `<ul class="seeds">
<li><a title="潜伏[全30集][中文字幕].Lurk.S01.2160p.H265[41.73G]" href="/link_start/?seed_id=11&movie_title=x">潜伏…</a> / <code class="size">41.73G</code>
<code class="seed-feature">4K</code><span class="create-time">2026-10-07 00:41</span></li>
<li><a title="Lurk.E01.720p[1.2G]" href="/link_start/?seed_id=12&movie_title=x">Lurk</a> / <code class="size">1.2G</code></li></ul>`
)

func TestSeedHubReader(t *testing.T) {
	magnet := "magnet:?xt=urn:btih:4add1d8f4edbc01adcb4b0aad0a142165f02db8e"
	mux := http.NewServeMux()
	mux.HandleFunc("/s/", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(hubSearch)) })
	mux.HandleFunc("/movies/8009/", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(hubTitle)) })
	mux.HandleFunc("/link_start/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("seed_id") != "11" {
			w.WriteHeader(404)
			return
		}
		_, _ = w.Write([]byte(`<script>const data = "` + base64.StdEncoding.EncodeToString([]byte(magnet)) + `";</script>`))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	reader, err := SeedHubReader(srv.URL+"/s/{q}/", srv.Client())
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	titles, err := reader.Titles(ctx, "潜伏")
	if err != nil || len(titles) != 1 {
		t.Fatalf("titles: %v %+v", err, titles)
	}
	if got := titles[0]; got.ID != "8009" || got.Title != "潜伏" || got.Year != 2009 || got.Kind != "剧集" || got.Rating != 9.1 || got.Info != "Lurk" {
		t.Fatalf("title: %+v", got)
	}
	seeds, err := reader.Seeds(ctx, "8009")
	if err != nil || len(seeds) != 2 {
		t.Fatalf("seeds: %v %+v", err, seeds)
	}
	if s := seeds[0]; s.ID != "11" || s.Title != "潜伏[全30集][中文字幕].Lurk.S01.2160p.H265" || s.Size != "41.73G" || len(s.Features) != 1 || s.Date == "" {
		t.Fatalf("seed: %+v", s)
	}
	got, err := reader.Magnet(ctx, "11")
	if err != nil || got != magnet {
		t.Fatalf("magnet: %v %q", err, got)
	}
	if _, err := reader.Magnet(ctx, "12"); err == nil {
		t.Fatal("a missing seed page should fail")
	}
	if _, err := reader.Seeds(ctx, "../etc"); err == nil {
		t.Fatal("ids are numbers")
	}
}
