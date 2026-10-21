package tgvio

import "testing"

func TestNameIndex(t *testing.T) {
	n := &NameIndex{path: t.TempDir() + "/names.json.gz", dirs: map[string]*nameDir{}}
	n.Record("/115/我要看", []NameEntry{{Name: "老友记 (1994)", Dir: true}, {Name: "Interstellar.2014.1080p.mkv", Size: 9}})
	n.Record("/115/我要看/老友记 (1994)", []NameEntry{{Name: "老友记 第四季 (1997)", Dir: true}})
	n.Record("/115/我要看/老友记 (1994)/老友记 第四季 (1997)", []NameEntry{{Name: "老友记 - S04E24.mkv"}})
	all := func(string) bool { return true }
	if hits := n.Search("interstellar 2014", 10, all); len(hits) != 1 || hits[0].Parent != "/115/我要看" {
		t.Fatalf("words across separators: %+v", hits)
	}
	if hits := n.Search("老友记", 10, all); len(hits) != 3 || !hits[0].Dir {
		t.Fatalf("folders first: %+v", hits)
	}
	if hits := n.Search("老友记", 10, func(dir string) bool { return dir == "/115/我要看" }); len(hits) != 1 {
		t.Fatalf("access filter: %+v", hits)
	}
	// The series folder is gone from its parent: its subtree goes too.
	n.Record("/115/我要看", []NameEntry{{Name: "Interstellar.2014.1080p.mkv"}})
	if hits := n.Search("老友记", 10, all); len(hits) != 0 || n.Folders() != 1 || n.total != 1 {
		t.Fatalf("stale subtree kept: %+v folders=%d total=%d", hits, n.Folders(), n.total)
	}
}
