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
var libraryExtras = regexp.MustCompile(`(?i)^(subs?|subtitles?|字幕|花絮|特典|幕后花絮|extras?|featurettes?|behind the scenes|bonus|samples?|预告片?|trailers?|sp|ova|oad|pv|pvs|ncop|nced|ncop[&+ ]?nced|scans?|cds?|cd\d*|disc\s*\d*|fonts?|artwork|booklet|menus?|covers?|proof|liner|posters?|screens?|storyboards?)$`)

// extrasPath reports whether a path goes through an extras folder (Scans,
// Fonts, Subs…): what is inside is a part of a title, never a title. The
// library keeps the title and drops those, as the drive page shows them only
// once one opens the title itself.
func extrasPath(path string) bool {
	for _, seg := range strings.Split(strings.Trim(path, "/"), "/") {
		if seg != "" && libraryExtras.MatchString(strings.TrimSpace(seg)) {
			return true
		}
	}
	return false
}

// shareScope is a share looked at by someone who may not be signed in: the
// library is then built from the shared paths only, and every path it reports
// is relative to the share (as the share's own visitor sees it).
type shareScope struct {
	sharing *model.Sharing
	pwd     string
}

// shareOf reads the share a request asks for: ?share=<id>&share_pwd=<code>.
// A share that is gone, expired or locked with another code is an error, the
// same one the share's own pages give.
func shareOf(c *gin.Context) (*shareScope, error) {
	id := c.Query("share")
	if id == "" {
		return nil, nil
	}
	s, err := op.GetSharingById(id)
	if err != nil {
		return nil, errs.SharingNotFound
	}
	if !s.Valid() {
		return nil, errs.InvalidSharing
	}
	if !s.Verify(c.Query("share_pwd")) {
		return nil, errs.WrongShareCode
	}
	return &shareScope{sharing: s, pwd: c.Query("share_pwd")}, nil
}

// holds reports whether a real path is in the share: one of its roots, or
// something under one (a share of a single file holds that file and nothing else).
func (s *shareScope) holds(real string) bool {
	for _, f := range s.sharing.Files {
		if real == f || utils.IsSubPath(f, real) {
			return true
		}
	}
	return false
}

// under reports whether a real folder can be listed through the share: the
// folder itself, an ancestor above it that is a root, or a root under it.
func (s *shareScope) under(real string) bool {
	return s.holds(real) || s.holds(stdpath.Dir(real))
}

// shown is a real path as this share's visitor sees it. A share of one folder
// opens on that folder, so it is "/" and its contents are under it; a share of
// several lists them by name, so each is "/<name>".
func (s *shareScope) shown(real string) (string, bool) {
	if len(s.sharing.Files) == 1 {
		f := s.sharing.Files[0]
		switch {
		case real == f:
			return "/", true
		case utils.IsSubPath(f, real):
			return strings.TrimPrefix(real, f), true
		}
		return "", false
	}
	for _, f := range s.sharing.Files {
		switch {
		case real == f:
			return "/" + stdpath.Base(f), true
		case utils.IsSubPath(f, real):
			return "/" + stdpath.Base(f) + strings.TrimPrefix(real, f), true
		}
	}
	return "", false
}

// roots are the real folders the share offers, for "is this in the library".
func (s *shareScope) roots() []string { return s.sharing.Files }

// mayOpen reports whether the share lets a visitor into a real folder. The
// share is the permission: its own paths, no folder password asked again.
func (s *shareScope) mayOpen(real string) bool { return s.under(real) }

// shareErrorResp writes the errors shareOf returns, as the share pages report them.
func shareErrorResp(c *gin.Context, err error) {
	switch {
	case errors.Is(err, errs.SharingNotFound):
		common.ErrorStrResp(c, "the share does not exist", 500)
	case errors.Is(err, errs.InvalidSharing):
		common.ErrorStrResp(c, "the share has expired or is no longer valid", 500)
	default:
		common.ErrorResp(c, err, 403)
	}
}

// TgvioLibrary: GET /api/tgvio/library — the caller's library, or with
// ?share=<id>&share_pwd=<code> the library of what that share holds.
func TgvioLibrary(c *gin.Context) {
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	share, err := shareOf(c)
	if err != nil {
		shareErrorResp(c, err)
		return
	}
	type pick struct {
		entry   tgvio.Poster
		path    string
		file    bool
		seasons map[int]bool
		first   int64
		places  []string
	}
	picks := map[string]*pick{}
	type cand struct {
		entry tgvio.Poster
		path  string
		file  bool
	}
	cands := map[string][]cand{} // every place a title was found as
	type placed struct{ path, key string }
	var seen []placed
	allowed := map[string]bool{} // real folder -> may open
	mayOpen := func(dir string) bool {
		if ok, seen := allowed[dir]; seen {
			return ok
		}
		var ok bool
		if share != nil {
			// The share is the permission: its own paths, whatever the folder's password.
			ok = share.mayOpen(dir)
		} else {
			meta, err := op.GetNearestMeta(dir)
			ok = (err == nil || errors.Is(errors.Cause(err), errs.MetaNotFound)) && webCanAccess(user, meta, dir, "")
		}
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
		real := stdpath.Join(entry.Dir, entry.Name)
		var shown string
		var ok bool
		if share != nil {
			// The share is the boundary: the title may sit above the shared
			// folder (a share of one season), so the path that counts is the
			// title's own, not the folder it was looked up in.
			if !posters().Enabled() {
				continue
			}
			if shown, ok = share.shown(real); !ok {
				continue
			}
		} else {
			if !posters().InLibrary(entry.Dir) {
				continue // outside the library paths (or the library is off)
			}
			if !mayOpen(entry.Dir) {
				continue
			}
			if shown, ok = user.ShowPath(real); !ok {
				continue
			}
		}
		// Names looked up as "series + season folder" do not name a real object.
		if prefix := stdpath.Base(entry.Dir) + " "; entry.Season > 0 && strings.HasPrefix(entry.Name, prefix) && entry.Dir != "/" {
			continue
		}
		if libraryExtras.MatchString(strings.TrimSpace(entry.Name)) {
			continue
		}
		// Anything inside an extras folder (PV/Scans/Fonts/Discs) belongs to
		// the title above it: one card for the title, never one for its PVs.
		if extrasPath(shown) {
			continue
		}
		file := tgvio.IsMediaFile(entry.Name) // a file shares its folder's access
		key := entry.Kind + "/" + strconv.Itoa(entry.ID)
		seen = append(seen, placed{shown, key})
		cands[key] = append(cands[key], cand{entry, shown, file})
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
	// A share's own root is the title the share is about: other things found
	// inside it do not turn it into a shelf.
	shareRoots := map[string]bool{}
	if share != nil {
		for _, root := range share.roots() {
			if shown, ok := share.shown(root); ok {
				shareRoots[shown] = true
			}
		}
	}
	items := make([]libraryItem, 0, len(picks))
	for key, p := range picks {
		// The card goes to the best place that is no shelf: a series' folder named
		// for its first film ("哈利·波特" as 魔法石) leaves the card to the film's own folder.
		var best *cand
		for i := range cands[key] {
			c := &cands[key][i]
			if !c.file && shelf(c.path, key) && !shareRoots[c.path] {
				continue
			}
			if best == nil || better(&pick{entry: best.entry, path: best.path, file: best.file}, c.file, c.entry, c.path) {
				best = c
			}
		}
		if best == nil {
			continue
		}
		p.entry, p.path, p.file = best.entry, best.path, best.file
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
	share, err := shareOf(c)
	if err != nil {
		shareErrorResp(c, err)
		return
	}
	p := posters()
	enabled := p.Enabled() && p.Config().Enabled
	paths := []string{}
	if enabled {
		seen := map[string]bool{}
		add := func(shown string) {
			if !seen[shown] {
				seen[shown] = true
				paths = append(paths, shown)
			}
		}
		if share != nil {
			// A share visitor's library is the share itself: the page under
			// /@s never goes above it, so the scope is the share root.
			for _, root := range share.roots() {
				for _, lib := range p.Config().Paths {
					if utils.IsSubPath(lib, root) || utils.IsSubPath(root, lib) {
						add("/")
						break
					}
				}
			}
		} else {
			for _, lib := range p.Config().Paths {
				for _, root := range user.Roots() {
					if shown, ok := user.ShowPath(lib); ok && (utils.IsSubPath(root, lib) || utils.IsSubPath(lib, root)) {
						add(shown)
					}
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
	allowed := map[string]bool{}
	for _, item := range items {
		if item.Dir != "" {
			// A folder behind a password is left out, as in the library itself.
			ok, seen := allowed[item.Dir]
			if !seen {
				meta, err := op.GetNearestMeta(item.Dir)
				ok = (err == nil || errors.Is(errors.Cause(err), errs.MetaNotFound)) && webCanAccess(user, meta, item.Dir, "")
				allowed[item.Dir] = ok
			}
			if !ok {
				continue
			}
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

// --- a share's 片库, reachable without signing in -------------------------

// TgvioShareLibrary: GET /api/tgvio/share/library?share=<id>&share_pwd=<code>
// The share's own library on the route guests may use (a site with guest
// access off still lets the people a share was sent to see it).
func TgvioShareLibrary(c *gin.Context) {
	if c.Query("share") == "" {
		common.ErrorStrResp(c, "share is required", 400)
		return
	}
	TgvioLibrary(c)
}

// TgvioShareScope: the same for /api/tgvio/share/scope.
func TgvioShareScope(c *gin.Context) {
	if c.Query("share") == "" {
		common.ErrorStrResp(c, "share is required", 400)
		return
	}
	TgvioLibraryScope(c)
}

// TgvioShareSeries: POST /api/tgvio/share/series {share, share_pwd, path}.
func TgvioShareSeries(c *gin.Context) {
	var req seriesReq
	if err := c.ShouldBindJSON(&req); err != nil || req.Share == "" {
		common.ErrorStrResp(c, "share is required", 400)
		return
	}
	seriesFor(c, &req)
}
