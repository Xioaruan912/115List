package tgvio

import (
	stdpath "path"
	"strings"
	"time"
)

// When a file or folder is renamed, moved or removed, by any way (the browser,
// WebDAV, 整理, a mount path changed in 管理), what TGVIO remembers about it
// follows: poster records, 整理 marks, the library folders and the default
// download folder in settings. The server adds what needs users (继续观看,
// the 整理 journal) through OnPathMoved. Paths are real paths.

var (
	moveHooks   []func(oldPath, newPath string)
	removeHooks []func(path string)
)

// OnPathMoved and OnPathRemoved add what else follows a change (set at start-up).
func OnPathMoved(f func(oldPath, newPath string)) { moveHooks = append(moveHooks, f) }
func OnPathRemoved(f func(path string))           { removeHooks = append(removeHooks, f) }

func under(p, root string) bool { return p == root || strings.HasPrefix(p, root+"/") }

func moveUnder(p, oldPath, newPath string) string {
	if !under(p, oldPath) {
		return p
	}
	return newPath + strings.TrimPrefix(p, oldPath)
}

// PathMoved: oldPath is now newPath (renamed in place, or moved elsewhere).
func PathMoved(oldPath, newPath string) {
	oldPath, newPath = stdpath.Clean("/"+oldPath), stdpath.Clean("/"+newPath)
	if oldPath == newPath || oldPath == "/" {
		return
	}
	if t := tmdbInstance; t != nil {
		t.Renamed(stdpath.Dir(oldPath), stdpath.Base(oldPath), stdpath.Base(newPath), stdpath.Dir(newPath))
		t.RenamedDir(oldPath, newPath)
		cfg := t.Config()
		changed := false
		paths := append([]string(nil), cfg.Paths...)
		for i, p := range paths {
			if q := moveUnder(p, oldPath, newPath); q != p {
				paths[i], changed = q, true
			}
		}
		if changed {
			cfg.Paths = paths
			_ = t.SetConfig(cfg)
		}
	}
	if o := organizeInstance; o != nil {
		o.RenamedDir(oldPath, newPath)
	}
	if r := resourcesInstance; r != nil {
		if cfg := r.Config(); cfg.Folder != "" {
			if q := moveUnder(cfg.Folder, oldPath, newPath); q != cfg.Folder {
				cfg.Folder = q
				_, _ = r.Save(cfg)
			}
		}
	}
	for _, f := range moveHooks {
		f(oldPath, newPath)
	}
}

// MountMoved: a storage's mount path changed.
func MountMoved(oldPath, newPath string) { PathMoved(oldPath, newPath) }

// PathRemoved: path and everything below it are gone. Its records go, so the
// library never links to it (a choice made by hand goes too: the object is gone).
func PathRemoved(path string) {
	path = stdpath.Clean("/" + path)
	if path == "/" {
		return
	}
	if t := tmdbInstance; t != nil {
		t.forgetUnder(path)
	}
	if o := organizeInstance; o != nil {
		o.forgetUnder(path)
	}
	for _, f := range removeHooks {
		f(path)
	}
}

func (t *TMDB) forgetUnder(path string) {
	dir, name := stdpath.Dir(path), Key(stdpath.Base(path))
	t.mu.Lock()
	changed := false
	for key, entry := range t.entries {
		if under(entry.Dir, path) || key == name && entry.Dir == dir {
			delete(t.entries, key)
			changed = true
		}
	}
	t.mu.Unlock()
	if changed {
		t.save()
	}
}

func (o *Organize) forgetUnder(path string) {
	path = organizeKey(path)
	o.mu.Lock()
	defer o.mu.Unlock()
	changed := false
	for key := range o.at {
		if under(key, path) {
			delete(o.at, key)
			changed = true
		}
	}
	if changed {
		_ = o.saveLocked()
	}
	forgot := false
	for key := range o.seen {
		if under(key, path) {
			delete(o.seen, key)
			forgot = true
		}
	}
	if forgot {
		o.saveSeenLocked()
	}
}

// Moved carries a user's positions from one shown path to another. The old
// path is left as finished, so a device still holding it learns it is over
// (merging keeps the newer entry) instead of bringing it back.
func (s *WatchStore) Moved(user uint, oldPath, newPath string) {
	s.mu.Lock()
	entries := s.users[user]
	now := time.Now().UnixMilli()
	changed := false
	for p, e := range entries {
		if q := moveUnder(p, oldPath, newPath); q != p && !e.Done {
			e.At = now
			entries[q] = e
			entries[p] = WatchEntry{Done: true, At: now}
			changed = true
		}
	}
	s.mu.Unlock()
	if changed {
		s.save()
	}
}

// Users lists the users with positions.
func (s *WatchStore) Users() []uint {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]uint, 0, len(s.users))
	for id := range s.users {
		out = append(out, id)
	}
	return out
}
