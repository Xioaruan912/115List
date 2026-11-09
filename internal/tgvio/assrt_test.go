package tgvio

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"golang.org/x/time/rate"
)

func TestAssrt(t *testing.T) {
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/f1" { // download links are signed, no token
			w.Write([]byte("[Script Info]"))
			return
		}
		if r.Header.Get("Authorization") != "Bearer tok" {
			w.Write([]byte(`{"status":20001}`))
			return
		}
		switch r.URL.Path {
		case "/v1/sub/search":
			// The title alone (not assrt's fuzzy whole-file match) finds the packs.
			if r.URL.Query().Get("is_file") != "" || r.URL.Query().Get("q") != "Friends" {
				t.Errorf("search query %v", r.URL.Query())
			}
			w.Write([]byte(`{"status":0,"sub":{"subs":[{"id":601234,"native_name":"老友记 第四季","videoname":"Friends.S04E24","subtype":"ASS","lang":{"desc":"简英"},"vote_score":9}]}}`))
		case "/v1/sub/detail":
			w.Write([]byte(`{"status":0,"sub":{"subs":[{"id":601234,"filename":"pack.rar","url":"` + srv.URL + `/pack","filelist":[{"url":"` + srv.URL + `/f1","f":"Friends.S04E24.chs&eng.ass","s":"40KB"},{"url":"` + srv.URL + `/nfo","f":"readme.txt","s":"1KB"}]}]}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	a := &Assrt{base: srv.URL + "/v1/", token: "tok", http: srv.Client(), limiter: rate.NewLimiter(rate.Every(time.Millisecond), 10)}
	ctx := context.Background()
	results, err := a.Search(ctx, "Friends.S04E24.1080p.mkv", "")
	if err != nil || len(results) != 1 || results[0].ID != 601234 || results[0].Lang != "简英" {
		t.Fatalf("search: %+v %v", results, err)
	}
	files, err := a.Files(ctx, 601234)
	if err != nil || len(files) != 1 || files[0].Name != "Friends.S04E24.chs&eng.ass" {
		t.Fatalf("files: %+v %v", files, err)
	}
	data, err := a.Download(ctx, 601234, "Friends.S04E24.chs&eng.ass")
	if err != nil || string(data) != "[Script Info]" {
		t.Fatalf("download: %q %v", data, err)
	}
	a.token = "bad"
	if _, err := a.Search(ctx, "", "老友记"); err == nil || !strings.Contains(err.Error(), "invalid token") {
		t.Fatalf("bad token: %v", err)
	}
	for _, c := range [][4]string{
		{"老友记 - S04E24.mkv", "x.chs&eng.ass", "", "老友记 - S04E24.chs&eng.ass"},
		{"a.mkv", "a.cht.srt", "", "a.cht.srt"},
		{"a.mkv", "sub.ass", "简体", "a.chs.ass"},
		{"a.mkv", "sub.srt", "English", "a.eng.srt"},
		{"a.mkv", "sub.SRT", "", "a.zh.srt"},
	} {
		if got := SubtitleName(c[0], c[1], c[2]); got != c[3] {
			t.Errorf("SubtitleName(%q,%q,%q) = %q, want %q", c[0], c[1], c[2], got, c[3])
		}
	}
}

// assrt answers some searches in its older shape (fileid / m_title / m_lang):
// read as an empty result, the sheet listed entries with no id and every
// download failed with "id is required".
func TestAssrtOldShape(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok" {
			w.Write([]byte(`{"status":20001}`))
			return
		}
		w.Write([]byte(`{"status":0,"sub":{"subs":[{"fileid":"649119","m_title":"瞬息全宇宙/Everything.Everywhere","m_lang":"简&nbsp;英","m_subtype":"Subrip(srt)","score":"79","uploadtime":"2022-06-22 13:22:14","videoname":"","subtype":"2"}]}}`))
	}))
	defer srv.Close()
	a := &Assrt{base: srv.URL + "/v1/", token: "tok", http: srv.Client(), limiter: rate.NewLimiter(rate.Every(time.Millisecond), 10)}
	results, err := a.Search(context.Background(), "瞬息全宇宙 (2022).mkv", "瞬息全宇宙")
	if err != nil || len(results) != 1 {
		t.Fatalf("search: %+v %v", results, err)
	}
	got := results[0]
	if got.ID != 649119 || got.Name != "瞬息全宇宙/Everything.Everywhere" || got.Lang != "简 英" || got.Type != "Subrip(srt)" || got.Score != 79 || got.Uploaded != "2022-06-22 13:22:14" {
		t.Fatalf("old shape read as %+v", got)
	}
}
