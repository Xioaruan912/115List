package tgvio

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func TestMemoFreshStaleAndDisk(t *testing.T) {
	m := &memo[int]{name: "t", m: map[string]memoEntry[int]{}, refreshing: map[string]bool{}}
	calls := 0
	load := func(context.Context) (int, error) { calls++; return calls, nil }
	if v, _ := m.fetch(context.Background(), "k", load); v != 1 || calls != 1 {
		t.Fatalf("first -> %d calls %d", v, calls)
	}
	if v, _ := m.fetch(context.Background(), "k", load); v != 1 || calls != 1 {
		t.Fatalf("fresh -> %d calls %d", v, calls)
	}
	// Old: answered at once with what is kept, asked again in the background.
	m.m["k"] = memoEntry[int]{At: time.Now().Add(-13 * time.Hour), V: 1}
	if v, _ := m.fetch(context.Background(), "k", load); v != 1 {
		t.Fatalf("stale -> %d", v)
	}
	for i := 0; i < 100; i++ {
		if v, _, _ := m.get("k"); v == 2 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if v, _, _ := m.get("k"); v != 2 {
		t.Fatalf("refreshed -> %d", v)
	}
	// Kept on disk and read back; a month old is dropped.
	m.m["old"] = memoEntry[int]{At: time.Now().Add(-31 * 24 * time.Hour), V: 9}
	raw := m.save()
	back := &memo[int]{name: "t", m: map[string]memoEntry[int]{}, refreshing: map[string]bool{}}
	back.load(json.RawMessage(raw))
	if v, _, ok := back.get("k"); !ok || v != 2 {
		t.Fatalf("loaded -> %d %v", v, ok)
	}
	if _, _, ok := back.get("old"); ok {
		t.Fatal("a month old kept")
	}
}
