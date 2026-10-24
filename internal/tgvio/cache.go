package tgvio

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// What TMDB says about a film, a series, its seasons and a collection is kept
// on disk (data/tgvio/tmdb-cache.json, a month at most), so a restart does not
// make every series page and shelf ask TMDB again. Half a day old is fresh;
// older is still answered at once, and asked again in the background.

const (
	memoFresh = 12 * time.Hour
	memoKeep  = 30 * 24 * time.Hour
)

type memoEntry[T any] struct {
	At time.Time `json:"at"`
	V  T         `json:"v"`
}

// memo is one kind of TMDB answer by key.
type memo[T any] struct {
	name       string
	mu         sync.Mutex
	m          map[string]memoEntry[T]
	refreshing map[string]bool
}

func newMemo[T any](name string) *memo[T] {
	m := &memo[T]{name: name, m: map[string]memoEntry[T]{}, refreshing: map[string]bool{}}
	memos = append(memos, m)
	return m
}

func (m *memo[T]) get(key string) (T, time.Time, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.m[key]
	return e.V, e.At, ok
}

func (m *memo[T]) put(key string, v T) {
	m.mu.Lock()
	m.m[key] = memoEntry[T]{At: time.Now(), V: v}
	m.mu.Unlock()
	memoChanged()
}

// clear forgets everything (tests).
func (m *memo[T]) clear() {
	m.mu.Lock()
	m.m = map[string]memoEntry[T]{}
	m.mu.Unlock()
}

// fetch answers from the memo, asking TMDB (load) when there is nothing, and
// in the background when what there is is no longer fresh.
func (m *memo[T]) fetch(ctx context.Context, key string, load func(context.Context) (T, error)) (T, error) {
	v, at, ok := m.get(key)
	if ok && time.Since(at) < memoFresh {
		return v, nil
	}
	if ok {
		m.mu.Lock()
		busy := m.refreshing[key]
		m.refreshing[key] = true
		m.mu.Unlock()
		if !busy {
			go func() {
				bg, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				defer cancel()
				if fresh, err := load(bg); err == nil {
					m.put(key, fresh)
				}
				m.mu.Lock()
				delete(m.refreshing, key)
				m.mu.Unlock()
			}()
		}
		return v, nil
	}
	v, err := load(ctx)
	if err == nil {
		m.put(key, v)
	}
	return v, err
}

func (m *memo[T]) save() json.RawMessage {
	m.mu.Lock()
	defer m.mu.Unlock()
	for key, e := range m.m {
		if time.Since(e.At) > memoKeep {
			delete(m.m, key)
		}
	}
	raw, _ := json.Marshal(m.m)
	return raw
}

func (m *memo[T]) load(raw json.RawMessage) {
	var in map[string]memoEntry[T]
	if json.Unmarshal(raw, &in) != nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for key, e := range in {
		if time.Since(e.At) < memoKeep {
			m.m[key] = e
		}
	}
}

type memoStore interface {
	save() json.RawMessage
	load(json.RawMessage)
	memoName() string
}

func (m *memo[T]) memoName() string { return m.name }

var (
	memos     []memoStore
	memoMu    sync.Mutex
	memoFile  string // set once the poster store opens; empty: nothing is written (tests)
	memoTimer *time.Timer
)

// openMemos reads what was kept, and from then on writes changes (at most every 30 seconds).
func openMemos(dir string) {
	memoMu.Lock()
	memoFile = filepath.Join(dir, "tmdb-cache.json")
	file := memoFile
	memoMu.Unlock()
	raw, err := os.ReadFile(file)
	if err != nil {
		return
	}
	var all map[string]json.RawMessage
	if json.Unmarshal(raw, &all) != nil {
		return
	}
	for _, m := range memos {
		if part, ok := all[m.memoName()]; ok {
			m.load(part)
		}
	}
}

func memoChanged() {
	memoMu.Lock()
	defer memoMu.Unlock()
	if memoFile == "" || memoTimer != nil {
		return
	}
	memoTimer = time.AfterFunc(30*time.Second, saveMemos)
}

func saveMemos() {
	memoMu.Lock()
	file := memoFile
	memoTimer = nil
	memoMu.Unlock()
	all := map[string]json.RawMessage{}
	for _, m := range memos {
		all[m.memoName()] = m.save()
	}
	raw, err := json.Marshal(all)
	if err != nil {
		return
	}
	tmp := file + ".tmp"
	if os.WriteFile(tmp, raw, 0o600) == nil {
		_ = os.Rename(tmp, file)
	}
}
