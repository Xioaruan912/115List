package tgvio

import (
	"testing"
	"time"
)

func TestWatchMerge(t *testing.T) {
	s := &WatchStore{path: t.TempDir() + "/progress.json", users: map[uint]map[string]WatchEntry{}}
	now := time.Now().UnixMilli()
	s.Merge(1, map[string]WatchEntry{"/a.mkv": {Time: 100, Duration: 3600, At: now - 5000}})
	// An older report from another device does not move it back.
	out := s.Merge(1, map[string]WatchEntry{"/a.mkv": {Time: 10, Duration: 3600, At: now - 9000}})
	if out["/a.mkv"].Time != 100 {
		t.Fatalf("older entry won: %+v", out["/a.mkv"])
	}
	// A newer one, finished, replaces it.
	out = s.Merge(1, map[string]WatchEntry{"/a.mkv": {Time: 3590, Duration: 3600, At: now, Done: true}})
	if !out["/a.mkv"].Done {
		t.Fatalf("newer entry lost: %+v", out["/a.mkv"])
	}
	// A clock running ahead counts as now; users stay apart; junk is dropped.
	out = s.Merge(2, map[string]WatchEntry{"/b.mkv": {Time: 5, Duration: 60, At: now + 3600_000}, "": {Duration: 1}, "/c.mkv": {Time: 1}})
	if len(out) != 1 || out["/b.mkv"].At > time.Now().UnixMilli() {
		t.Fatalf("user 2: %+v", out)
	}
	if len(s.All(1)) != 1 {
		t.Fatalf("user 1 sees: %+v", s.All(1))
	}
}
