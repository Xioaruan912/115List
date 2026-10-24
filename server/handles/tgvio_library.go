package handles

import (
	stdpath "path"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/errs"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/internal/tgvio"
	"github.com/OpenListTeam/OpenList/v4/pkg/utils"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
)

// TGVIO: a library of everything TMDB recognised, across folders, read from
// the poster store only (no drive request). One card per film or series: the
// series' own folder when it has one, else its first season folder. Only what
// the user may open without a password is listed, under the path they see.

type libraryItem struct {
	*posterOut
	Path    string `json:"path"`
	File    bool   `json:"file,omitempty"`    // a video file, not a folder
	Seasons int    `json:"seasons,omitempty"` // season folders found for a series
	At      int64  `json:"at"`
	// Places: every folder or file the title was found as (season folders
	// elsewhere, a copy of the film), so a video can be traced to its title.
	Places []string `json:"places,omitempty"`
}

const libraryLimit = 5000

// Folders of extras, never a title of their own ("Subs" once matched a film called Subs).
var libraryExtras = regexp.MustCompile(`(?i)^(subs?|subtitles?|字幕|花絮|特典|幕后花絮|extras?|featurettes?|behind the scenes|bonus|samples?|预告片?|trailers?|sp|ova|oad|scans?|cd\d*|disc\s*\d*)$`)

// TgvioLibrary: GET /api/tgvio/library
func TgvioLibrary(c *gin.Context) {
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	type pick struct {
		entry   tgvio.Poster
		path    string
		file    bool
		seasons map[int]bool
		first   int64
		places  []string
	}
	picks := map[string]*pick{}
	type placed struct{ path, key string }
	var seen []placed
	allowed := map[string]bool{} // real folder -> may open
	mayOpen := func(dir string) bool {
		if ok, seen := allowed[dir]; seen {
			return ok
		}
		meta, err := op.GetNearestMeta(dir)
		ok := (err == nil || errors.Is(errors.Cause(err), errs.MetaNotFound)) && webCanAccess(user, meta, dir, "")
		allowed[dir] = ok
		return ok
	}
	better := func(cur *pick, file bool, entry tgvio.Poster, path string) bool {
		// A folder over a file, the series' own folder over a season's, then the shallower one.
		if cur.file != file {
			return !file
		}
		if (cur.entry.Season == 0) != (entry.Season == 0) {
			return entry.Season == 0
		}
		return strings.Count(path, "/") < strings.Count(cur.path, "/")
	}
	for _, entry := range posters().Library() {
		if !posters().InLibrary(entry.Dir) {
			continue // outside the library paths (or the library is off)
		}
		// Names looked up as "series + season folder" do not name a real object.
		if prefix := stdpath.Base(entry.Dir) + " "; entry.Season > 0 && strings.HasPrefix(entry.Name, prefix) && entry.Dir != "/" {
			continue
		}
		if libraryExtras.MatchString(strings.TrimSpace(entry.Name)) {
			continue
		}
		real := stdpath.Join(entry.Dir, entry.Name)
		if !mayOpen(entry.Dir) {
			continue
		}
		shown, ok := user.ShowPath(real)
		if !ok {
			continue
		}
		file := tgvio.IsMediaFile(entry.Name) // a file shares its folder's access
		key := entry.Kind + "/" + strconv.Itoa(entry.ID)
		seen = append(seen, placed{shown, key})
		cur := picks[key]
		if cur == nil {
			cur = &pick{entry: entry, path: shown, file: file, seasons: map[int]bool{}, first: entry.At}
			picks[key] = cur
		} else if better(cur, file, entry, shown) {
			cur.entry, cur.path, cur.file = entry, shown, file
		}
		if entry.Season > 0 {
			cur.seasons[entry.Season] = true
		}
		if len(cur.places) < 40 {
			cur.places = append(cur.places, shown)
		}
		if entry.At < cur.first {
			cur.first = entry.At
		}
	}
	// A folder holding other titles is a shelf ("我要看" once matched 阿凡达), not a title.
	sort.Slice(seen, func(i, j int) bool { return seen[i].path < seen[j].path })
	shelf := func(path, key string) bool {
		prefix := path + "/"
		i := sort.Search(len(seen), func(i int) bool { return seen[i].path >= prefix })
		for ; i < len(seen) && strings.HasPrefix(seen[i].path, prefix); i++ {
			if seen[i].key != key {
				return true
			}
		}
		return false
	}
	items := make([]libraryItem, 0, len(picks))
	for key, p := range picks {
		if !p.file && shelf(p.path, key) {
			continue
		}
		entry := p.entry
		if entry.Season > 0 {
			// A card for the whole series: drop the season from its title.
			if base := strings.TrimSpace(strings.SplitN(entry.Title, " 第", 2)[0]); base != "" {
				entry.Title = base
			}
			entry.Season = 0
		}
		items = append(items, libraryItem{posterOut: toPosterOut(&entry), Path: p.path, File: p.file, Seasons: len(p.seasons), At: p.first, Places: p.places})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].At > items[j].At })
	if len(items) > libraryLimit {
		items = items[:libraryLimit]
	}
	cfg := posters().Config()
	common.SuccessResp(c, gin.H{"items": items, "blur": cfg.Blur})
}

// TgvioLibraryScope: GET /api/tgvio/library/scope tells the browser where the
// media-library features apply: whether they are on, and the library paths the
// user can see (as they see them).
func TgvioLibraryScope(c *gin.Context) {
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	p := posters()
	enabled := p.Enabled() && p.Config().Enabled
	paths := []string{}
	if enabled {
		seen := map[string]bool{}
		add := func(real string) {
			if shown, ok := user.ShowPath(real); ok && !seen[shown] {
				seen[shown] = true
				paths = append(paths, shown)
			}
		}
		for _, lib := range p.Config().Paths {
			for _, root := range user.Roots() {
				switch {
				case utils.IsSubPath(root, lib): // a library folder inside the user's space
					add(lib)
				case utils.IsSubPath(lib, root): // the user's whole root lies in the library
					add(root)
				}
			}
		}
	}
	common.SuccessResp(c, gin.H{"enabled": enabled && len(paths) > 0, "paths": paths})
}

// TgvioLibraryNews: GET /api/tgvio/library/news — 追剧与新片: new seasons and
// episodes of series here, films of series here that are out or coming. Worked
// out in the background (computing: true until the first answer is ready).
func TgvioLibraryNews(c *gin.Context) {
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	items, computing, at := posters().News()
	out := make([]tgvio.NewsItem, 0, len(items))
	for _, item := range items {
		if item.Dir != "" {
			shown, ok := user.ShowPath(item.Dir)
			if !ok {
				continue
			}
			item.Dir = shown
		}
		if item.Into != "" {
			item.Into, _ = user.ShowPath(item.Into)
		}
		item.Poster = posterURL("w342", item.Poster)
		out = append(out, item)
	}
	common.SuccessResp(c, gin.H{"items": out, "computing": computing, "at": at})
}
