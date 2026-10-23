package tgvio

import (
	"context"
	"encoding/json"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// What 整理模式 needs to know beyond names (real paths, data/tgvio/organize.json):
//
//   pending  a folder 找资源 made: named the TMDB way already, but what lands
//            in it keeps the release's names until 按 TMDB 整理命名 runs
//            (dropped after 90 days)
//   done     went through 按 TMDB 整理命名 without a failure, or was marked
//            organized by hand: a collection folder keeps its own name, an
//            empty or non-film folder needs nothing
//
// Kept on the server so every device agrees.

type organizeEntry struct {
	At   time.Time `json:"at"`
	Done bool      `json:"done,omitempty"`
}

type Organize struct {
	path string
	mu   sync.Mutex
	at   map[string]organizeEntry
}

var (
	organizeOnce     sync.Once
	organizeInstance *Organize
)

const organizeTTL = 90 * 24 * time.Hour

func OrganizeStore(dataDir string) *Organize {
	organizeOnce.Do(func() {
		o := &Organize{path: filepath.Join(dataDir, "tgvio", "organize.json"), at: map[string]organizeEntry{}}
		if raw, err := os.ReadFile(o.path); err == nil {
			_ = json.Unmarshal(raw, &o.at)
		}
		organizeInstance = o
	})
	return organizeInstance
}

func organizeKey(p string) string { return path.Clean("/" + strings.TrimSpace(p)) }

// Mark sets a folder pending, or done (organized); done also settles what is pending below it.
func (o *Organize) Mark(p string, pending bool) error {
	p = organizeKey(p)
	o.mu.Lock()
	defer o.mu.Unlock()
	if !pending {
		for key, entry := range o.at {
			if strings.HasPrefix(key, p+"/") && !entry.Done {
				delete(o.at, key)
			}
		}
	}
	o.at[p] = organizeEntry{At: time.Now(), Done: !pending}
	return o.saveLocked()
}

// Children are the folders directly in dir by state; self is dir's own state ("", "pending" or "done").
func (o *Organize) Children(dir string) (pending, done []string, self string) {
	dir = organizeKey(dir)
	o.mu.Lock()
	defer o.mu.Unlock()
	pending, done = []string{}, []string{}
	for key, entry := range o.at {
		if !entry.Done && time.Since(entry.At) > organizeTTL {
			continue
		}
		state := "pending"
		if entry.Done {
			state = "done"
		}
		switch {
		case key == dir:
			self = state
		case path.Dir(key) == dir && entry.Done:
			done = append(done, path.Base(key))
		case path.Dir(key) == dir:
			pending = append(pending, path.Base(key))
		}
	}
	return pending, done, self
}

// Pending lists the folders waiting to be organized that were marked at least
// minAge ago (real paths).
func (o *Organize) Pending(minAge time.Duration) []string {
	o.mu.Lock()
	defer o.mu.Unlock()
	var out []string
	for key, entry := range o.at {
		if age := time.Since(entry.At); !entry.Done && age >= minAge && age <= organizeTTL {
			out = append(out, key)
		}
	}
	return out
}

func (o *Organize) saveLocked() error {
	for key, entry := range o.at {
		if !entry.Done && time.Since(entry.At) > organizeTTL {
			delete(o.at, key)
		}
	}
	raw, _ := json.Marshal(o.at)
	if err := os.MkdirAll(filepath.Dir(o.path), 0o700); err != nil {
		return err
	}
	tmp := o.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, o.path)
}

// Wants is what 按 TMDB 整理命名 would call each of these, worked out the way
// PlanRenameIn names a folder or a lone film, from the poster records (no
// drive listing): "" when TMDB knows nothing of it, "~" for a series' video
// (an episode, judged by its own name). Folders and files come separately.
func (t *TMDB) Wants(ctx context.Context, dir string, folders, files []string) map[string]string {
	out := make(map[string]string, len(folders)+len(files))
	found, _ := t.Lookup(dir, append(append([]string{}, folders...), files...))
	title := func(p *Poster) (string, int) {
		if p.Kind != "tv" {
			return SafeName(p.Title), p.Year
		}
		// A season's poster may carry the season in its title ("校外 第 1 季"): the series' own title.
		if base, err := t.cachedDetails(ctx, p.Kind, p.ID); err == nil {
			return SafeName(base.Title), base.Year
		}
		return SafeName(p.Title), p.Year
	}
	for _, name := range folders {
		p := found[name]
		if p == nil || p.None {
			out[name] = ""
			continue
		}
		name0, year := title(p)
		want := titleYear(name0, year)
		// A series' folder ("流浪地球", "招魂") is named for the series, not its first film.
		if _, y, _, _ := CleanName(name); p.Kind == "movie" && y == 0 && normalizeTitle(name) != "" &&
			strings.HasPrefix(normalizeTitle(name0), normalizeTitle(name)) {
			if d, err := t.cachedDetails(ctx, "movie", p.ID); err == nil && d.Collection > 0 {
				want = name
			}
		}
		if p.Kind == "tv" {
			season := SeasonOf(name)
			if season == 0 {
				season = p.Season
			}
			if season > 0 {
				for _, s := range t.cachedSeasons(ctx, p.ID) {
					if s.Season == season && s.Year > 0 {
						year = s.Year
					}
				}
				want = titleYear(name0+" 第"+cnNumeral(season)+"季", year)
			}
		}
		out[name] = want
	}
	for _, name := range files {
		p := found[name]
		switch {
		case p == nil || p.None:
			out[name] = ""
		case p.Kind == "tv":
			out[name] = "~"
		default:
			name0, year := title(p)
			out[name] = titleYear(name0, year) + extOf(name)
		}
	}
	return out
}
