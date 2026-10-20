package tgvio

import (
	"sort"
	"testing"
	"time"
)

func TestOrganizeStore(t *testing.T) {
	o := &Organize{path: t.TempDir() + "/organize.json", at: map[string]organizeEntry{}}
	for _, p := range []string{"/115/我要看/潜伏 (2009)", "/115/我要看/潜伏 系列", "/115/我要看/潜伏 系列/潜伏2 (2013)"} {
		if err := o.Mark(p, true); err != nil {
			t.Fatal(err)
		}
	}
	pending, done, self := o.Children("/115/我要看/")
	sort.Strings(pending)
	if self != "" || len(pending) != 2 || pending[0] != "潜伏 (2009)" || len(done) != 0 {
		t.Fatalf("children: %v %v %q", pending, done, self)
	}
	if _, _, self := o.Children("/115/我要看/潜伏 (2009)"); self != "pending" {
		t.Fatalf("the folder itself: %q", self)
	}
	// Organizing a folder settles what is pending below it, and remembers it as done.
	_ = o.Mark("/115/我要看/潜伏 系列", false)
	if pending, _, _ := o.Children("/115/我要看/潜伏 系列"); len(pending) != 0 {
		t.Fatalf("below an organized folder: %v", pending)
	}
	if _, done, _ := o.Children("/115/我要看"); len(done) != 1 || done[0] != "潜伏 系列" {
		t.Fatalf("done: %v", done)
	}
	// Old pending marks drop off; done ones stay.
	o.at["/old"] = organizeEntry{At: time.Now().Add(-100 * 24 * time.Hour)}
	o.at["/kept"] = organizeEntry{At: time.Now().Add(-100 * 24 * time.Hour), Done: true}
	pending, done, _ = o.Children("/")
	if len(pending) != 0 || len(done) != 1 {
		t.Fatalf("expiry: %v %v", pending, done)
	}
}
