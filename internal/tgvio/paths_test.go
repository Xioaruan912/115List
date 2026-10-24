package tgvio

import (
	"path/filepath"
	"testing"
)

func TestPathMovedAndRemoved(t *testing.T) {
	tm := planTMDB(t, []tmdbItem{film(1, "黑豹", "2018-02-13", 0, "")}, map[string]int{"黑豹 (2018)": 1, "黑豹 (2018).iso": 1})
	tm.entries[Key("黑豹 (2018)")].Dir = "/lib/漫威"
	tm.entries[Key("黑豹 (2018).iso")].Dir = "/lib/漫威/黑豹 (2018)"
	tm.cfgOnce.Do(func() {})
	tm.cfg = PosterConfig{Enabled: true, Language: "zh-CN", Paths: []string{"/lib"}}
	o := &Organize{path: filepath.Join(t.TempDir(), "organize.json"), at: map[string]organizeEntry{}}
	_ = o.Mark("/lib/漫威/黑豹 (2018)", false)
	keepT, keepO := tmdbInstance, organizeInstance
	tmdbInstance, organizeInstance = tm, o
	defer func() { tmdbInstance, organizeInstance = keepT, keepO }()

	// The box opens: 黑豹 moves to the library's root.
	PathMoved("/lib/漫威/黑豹 (2018)", "/lib/黑豹 (2018)")
	if d := tm.entries[Key("黑豹 (2018)")].Dir; d != "/lib" {
		t.Fatalf("folder record in %q", d)
	}
	if d := tm.entries[Key("黑豹 (2018).iso")].Dir; d != "/lib/黑豹 (2018)" {
		t.Fatalf("file record in %q", d)
	}
	if _, done, _ := o.Children("/lib"); len(done) != 1 || done[0] != "黑豹 (2018)" {
		t.Fatalf("整理 mark -> %v", done)
	}
	// The library's own folder is renamed: the settings follow.
	PathMoved("/lib", "/影视库")
	if p := tm.Config().Paths; len(p) != 1 || p[0] != "/影视库" {
		t.Fatalf("library paths -> %v", p)
	}
	if d := tm.entries[Key("黑豹 (2018).iso")].Dir; d != "/影视库/黑豹 (2018)" {
		t.Fatalf("file record after the root moved: %q", d)
	}
	// Deleted: nothing links to it any more.
	PathRemoved("/影视库/黑豹 (2018)")
	if tm.entries[Key("黑豹 (2018)")] != nil || tm.entries[Key("黑豹 (2018).iso")] != nil {
		t.Fatal("records of a deleted folder stay")
	}
}

func TestWatchMoved(t *testing.T) {
	s := &WatchStore{path: filepath.Join(t.TempDir(), "p.json"), users: map[uint]map[string]WatchEntry{1: {"/a/x.mkv": {Time: 30, At: 1}}}}
	s.Moved(1, "/a", "/b")
	if e := s.users[1]["/b/x.mkv"]; e.Time != 30 {
		t.Fatalf("moved entry %+v", e)
	}
	if e := s.users[1]["/a/x.mkv"]; !e.Done || e.At <= 1 {
		t.Fatalf("old entry %+v", e)
	}
}
