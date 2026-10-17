package tgvio

import (
	"compress/gzip"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// A name index for search on drives where OpenList's own index is off (115:
// indexing means crawling the drive, which its WAF punishes). It learns from
// the listings OpenList makes anyway, through the objects-update hook: every
// folder someone has opened is searchable afterwards, nothing is crawled. A
// folder listed again replaces what was known of it, and subfolders that are
// gone take their own entries with them. Kept in <data>/tgvio/names.json.gz.

// NameEntry is one object of a listed folder.
type NameEntry struct {
	Name string `json:"n"`
	Dir  bool   `json:"d,omitempty"`
	Size int64  `json:"s,omitempty"`
	fold string // Fold(Name), filled when recorded or loaded
}

type nameDir struct {
	At      int64       `json:"at"`
	Entries []NameEntry `json:"e"`
}

// NameHit is a search result: the folder (real path) and the object in it.
type NameHit struct {
	Parent string
	NameEntry
	score int
}

const nameLimit = 400_000 // objects kept across all folders

type NameIndex struct {
	path   string
	mu     sync.RWMutex
	dirs   map[string]*nameDir
	total  int
	saveAt *time.Timer
}

var (
	namesOnce     sync.Once
	namesInstance *NameIndex
)

// Names returns the process-wide name index rooted in the data directory.
func Names(dataDir string) *NameIndex {
	namesOnce.Do(func() {
		n := &NameIndex{path: filepath.Join(dataDir, "tgvio", "names.json.gz"), dirs: map[string]*nameDir{}}
		if f, err := os.Open(n.path); err == nil {
			if zr, err := gzip.NewReader(f); err == nil {
				_ = json.NewDecoder(zr).Decode(&n.dirs)
				zr.Close()
			}
			f.Close()
		}
		for _, d := range n.dirs {
			n.total += len(d.Entries)
			for i := range d.Entries {
				d.Entries[i].fold = Fold(d.Entries[i].Name)
			}
		}
		namesInstance = n
	})
	return namesInstance
}

// Folders reports how many folders the index knows.
func (n *NameIndex) Folders() int {
	n.mu.RLock()
	defer n.mu.RUnlock()
	return len(n.dirs)
}

// Record replaces what is known of a folder with a fresh listing.
func (n *NameIndex) Record(parent string, entries []NameEntry) {
	parent = cleanDir(parent)
	for i := range entries {
		entries[i].fold = Fold(entries[i].Name)
	}
	n.mu.Lock()
	present := map[string]bool{}
	for _, e := range entries {
		if e.Dir {
			present[e.Name] = true
		}
	}
	if old := n.dirs[parent]; old != nil {
		n.total -= len(old.Entries)
		for _, e := range old.Entries {
			if e.Dir && !present[e.Name] {
				n.dropTreeLocked(joinDir(parent, e.Name))
			}
		}
	}
	n.dirs[parent] = &nameDir{At: time.Now().Unix(), Entries: entries}
	n.total += len(entries)
	if n.total > nameLimit {
		n.trimLocked()
	}
	n.mu.Unlock()
	n.save()
}

func (n *NameIndex) dropTreeLocked(dir string) {
	if d := n.dirs[dir]; d != nil {
		n.total -= len(d.Entries)
		delete(n.dirs, dir)
		for _, e := range d.Entries {
			if e.Dir {
				n.dropTreeLocked(joinDir(dir, e.Name))
			}
		}
	}
}

// trimLocked forgets the folders listed longest ago until the index fits again.
func (n *NameIndex) trimLocked() {
	keys := make([]string, 0, len(n.dirs))
	for key := range n.dirs {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool { return n.dirs[keys[i]].At < n.dirs[keys[j]].At })
	for _, key := range keys {
		if n.total <= nameLimit*9/10 {
			break
		}
		n.total -= len(n.dirs[key].Entries)
		delete(n.dirs, key)
	}
}

// Fold makes names comparable: lower case, separators as spaces.
func Fold(s string) string {
	s = strings.ToLower(s)
	return strings.Map(func(r rune) rune {
		switch r {
		case '.', '_', '-', '[', ']', '(', ')', '【', '】', '（', '）', '·', '　':
			return ' '
		}
		return r
	}, s)
}

// Search finds objects whose names contain every word of the query, best
// first: whole-name and prefix matches, folders, then shorter names. allow
// filters folders (real paths) the asker may open.
func (n *NameIndex) Search(query string, limit int, allow func(dir string) bool) []NameHit {
	words := strings.Fields(Fold(query))
	if len(words) == 0 {
		return nil
	}
	n.mu.RLock()
	var hits []NameHit
	for parent, d := range n.dirs {
		var allowed *bool
		for _, e := range d.Entries {
			folded := e.fold
			score := 0
			for _, w := range words {
				i := strings.Index(folded, w)
				if i < 0 {
					score = -1
					break
				}
				if i == 0 {
					score += 3
				}
			}
			if score < 0 {
				continue
			}
			if allowed == nil {
				ok := allow(parent)
				allowed = &ok
			}
			if !*allowed {
				break
			}
			if folded == strings.Join(words, " ") {
				score += 6
			}
			if e.Dir {
				score += 2
			}
			hits = append(hits, NameHit{Parent: parent, NameEntry: e, score: score*1000 - len([]rune(e.Name))})
		}
	}
	n.mu.RUnlock()
	sort.Slice(hits, func(i, j int) bool { return hits[i].score > hits[j].score })
	if len(hits) > limit {
		hits = hits[:limit]
	}
	return hits
}

func cleanDir(dir string) string {
	if dir == "" {
		return "/"
	}
	if len(dir) > 1 {
		dir = strings.TrimRight(dir, "/")
	}
	return dir
}

func joinDir(dir, name string) string {
	if dir == "/" {
		return "/" + name
	}
	return dir + "/" + name
}

func (n *NameIndex) save() {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.saveAt != nil {
		n.saveAt.Stop()
	}
	n.saveAt = time.AfterFunc(30*time.Second, func() {
		_ = os.MkdirAll(filepath.Dir(n.path), 0o700)
		tmp := n.path + ".tmp"
		f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
		if err != nil {
			return
		}
		zw := gzip.NewWriter(f)
		n.mu.RLock()
		err = json.NewEncoder(zw).Encode(n.dirs)
		n.mu.RUnlock()
		if zw.Close() != nil || f.Close() != nil || err != nil {
			os.Remove(tmp)
			return
		}
		_ = os.Rename(tmp, n.path)
	})
}
