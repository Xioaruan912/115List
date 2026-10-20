package tgvio

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestTemplateSiteSearchURL(t *testing.T) {
	site := TemplateSite{ResourceSite{Search: "https://www.seedhub.cc/s/{q}/"}}
	if got := site.SearchURL(" 潜伏 2009 "); got != "https://www.seedhub.cc/s/%E6%BD%9C%E4%BC%8F%202009/" {
		t.Fatalf("got %s", got)
	}
}

func TestProbeStates(t *testing.T) {
	mux := http.NewServeMux()
	srv := httptest.NewServer(mux)
	defer srv.Close()
	client := srv.Client()
	cases := map[string]http.HandlerFunc{
		"ok": func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("<html>hi</html>")) },
		"challenge": func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(403)
			_, _ = w.Write([]byte("<title>Just a moment...</title>"))
		},
		"down": func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(502) },
	}
	for want, handler := range cases {
		one := httptest.NewServer(handler)
		got := TemplateSite{ResourceSite{ID: want, Search: one.URL + "/s/{q}/"}}.Probe(context.Background(), client)
		one.Close()
		if got.State != want {
			t.Errorf("%s: got %+v", want, got)
		}
	}
	got := TemplateSite{ResourceSite{Search: "http://127.0.0.1:1/s/{q}"}}.Probe(context.Background(), client)
	if got.State != "down" {
		t.Errorf("closed port: %+v", got)
	}
}

func TestResourcesSave(t *testing.T) {
	r := &Resources{path: t.TempDir() + "/resources.json", cfg: DefaultResources()}
	cfg, err := r.Save(ResourceConfig{Enabled: true, Sites: []ResourceSite{
		{Name: "SeedHub", Search: "https://www.seedhub.cc/s/{q}/"},
		{Name: "Copy", Search: "https://www.seedhub.cc/search?k={q}"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Sites[0].ID != "seedhub-cc" || cfg.Sites[1].ID != "seedhub-cc-2" {
		t.Fatalf("ids: %+v", cfg.Sites)
	}
	if _, err := r.Save(ResourceConfig{Sites: []ResourceSite{{Name: "x", Search: "https://example.com/"}}}); err == nil {
		t.Fatal("an address without {q} should be refused")
	}
	if _, err := r.Save(ResourceConfig{Sites: []ResourceSite{{Name: "x", Search: "javascript:alert({q})"}}}); err == nil {
		t.Fatal("a non-http address should be refused")
	}
}
