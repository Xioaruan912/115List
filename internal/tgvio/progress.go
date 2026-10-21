package tgvio

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// Where each user left off in each video, kept on the server so a film started
// on the phone resumes on the laptop. Clients merge entry by entry: the newer
// one wins, and a finished video stays as a "done" entry (so another device
// learns it is finished instead of resuming it). One JSON file in
// <data>/tgvio/progress.json, written a moment after the last change.

// WatchEntry is one video's position, by the path the user sees.
type WatchEntry struct {
	Time     float64 `json:"time"`
	Duration float64 `json:"duration"`
	At       int64   `json:"at"` // milliseconds since the epoch
	Done     bool    `json:"done,omitempty"`
}

const watchPerUser = 2000

type WatchStore struct {
	path   string
	mu     sync.Mutex
	users  map[uint]map[string]WatchEntry
	saveAt *time.Timer
}

var (
	watchOnce     sync.Once
	watchInstance *WatchStore
)

// Watching returns the process-wide progress store rooted in the data directory.
func Watching(dataDir string) *WatchStore {
	watchOnce.Do(func() {
		s := &WatchStore{path: filepath.Join(dataDir, "tgvio", "progress.json"), users: map[uint]map[string]WatchEntry{}}
		if raw, err := os.ReadFile(s.path); err == nil {
			_ = json.Unmarshal(raw, &s.users)
		}
		watchInstance = s
	})
	return watchInstance
}

// All returns a copy of a user's entries.
func (s *WatchStore) All(user uint) map[string]WatchEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make(map[string]WatchEntry, len(s.users[user]))
	for path, entry := range s.users[user] {
		out[path] = entry
	}
	return out
}

// Merge takes a client's entries, keeping the newer of each pair, and returns
// the user's entries after the merge. Times from the future (a device whose
// clock runs ahead) count as now.
func (s *WatchStore) Merge(user uint, items map[string]WatchEntry) map[string]WatchEntry {
	now := time.Now().UnixMilli()
	s.mu.Lock()
	mine := s.users[user]
	if mine == nil {
		mine = map[string]WatchEntry{}
		s.users[user] = mine
	}
	changed := false
	for path, entry := range items {
		if path == "" || len(path) > 2048 || entry.Duration <= 0 || entry.Time < 0 {
			continue
		}
		if entry.At > now {
			entry.At = now
		}
		if cur, ok := mine[path]; ok && cur.At >= entry.At {
			continue
		}
		mine[path] = entry
		changed = true
	}
	if len(mine) > watchPerUser {
		paths := make([]string, 0, len(mine))
		for path := range mine {
			paths = append(paths, path)
		}
		sort.Slice(paths, func(i, j int) bool { return mine[paths[i]].At < mine[paths[j]].At })
		for _, path := range paths[:len(mine)-watchPerUser] {
			delete(mine, path)
		}
	}
	out := make(map[string]WatchEntry, len(mine))
	for path, entry := range mine {
		out[path] = entry
	}
	s.mu.Unlock()
	if changed {
		s.save()
	}
	return out
}

func (s *WatchStore) save() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.saveAt != nil {
		s.saveAt.Stop()
	}
	s.saveAt = time.AfterFunc(2*time.Second, func() {
		s.mu.Lock()
		raw, err := json.Marshal(s.users)
		s.mu.Unlock()
		if err != nil {
			return
		}
		_ = os.MkdirAll(filepath.Dir(s.path), 0o700)
		tmp := s.path + ".tmp"
		if os.WriteFile(tmp, raw, 0o600) == nil {
			_ = os.Rename(tmp, s.path)
		}
	})
}
