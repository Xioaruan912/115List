package handles

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	stdpath "path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/OpenListTeam/OpenList/v4/cmd/flags"
	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/errs"
	"github.com/OpenListTeam/OpenList/v4/internal/fs"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/offline_download/tool"
	"github.com/OpenListTeam/OpenList/v4/internal/tgvio"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
)

// TGVIO: 追番 — a followed season is checked against the resource site, and an
// episode the library does not have yet is downloaded by itself. The download
// lands in the folder 找资源 uses; the organizer files it into the season.

type followEntry struct {
	Path      string           `json:"path"` // the season's folder (real)
	TMDb      int              `json:"tmdb"`
	Title     string           `json:"title"`
	Season    int              `json:"season"`
	Site      string           `json:"site"`
	SeedTitle string           `json:"seed_title"`
	Query     string           `json:"query"`
	At        int64            `json:"at"`
	Requested map[string]int64 `json:"requested,omitempty"` // release -> first asked (unix)
}

type followStore struct {
	path  string
	mu    sync.Mutex
	items []followEntry
}

var (
	followOnce sync.Once
	followInst *followStore
)

func follows() *followStore {
	followOnce.Do(func() {
		followInst = &followStore{path: filepath.Join(flags.DataDir, "tgvio", "follows.json")}
		if raw, err := os.ReadFile(followInst.path); err == nil {
			_ = json.Unmarshal(raw, &followInst.items)
		}
	})
	return followInst
}

func (s *followStore) saveLocked() {
	if raw, err := json.Marshal(s.items); err == nil {
		_ = os.WriteFile(s.path, raw, 0o600)
	}
}

func (s *followStore) find(path string) int {
	for i := range s.items {
		if s.items[i].Path == path {
			return i
		}
	}
	return -1
}

func (s *followStore) list() []followEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]followEntry, len(s.items))
	for i, it := range s.items {
		it.Requested = nil
		out[i] = it
	}
	return out
}

// TgvioFollowList: GET /api/tgvio/follow — the seasons followed.
func TgvioFollowList(c *gin.Context) {
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	out := []followEntry{}
	for _, it := range follows().list() {
		if shown, ok := user.ShowPath(it.Path); ok {
			it.Path = shown
			out = append(out, it)
		}
	}
	common.SuccessResp(c, gin.H{"items": out, "enabled": resourceSites().Config().Enabled})
}

type followReq struct {
	Path string `json:"path"`
}

// TgvioFollowAdd: POST /api/tgvio/follow {path} — follow that season.
func TgvioFollowAdd(c *gin.Context) {
	var req followReq
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Path) == "" {
		common.ErrorStrResp(c, "path is required", 400)
		return
	}
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	real, err := user.JoinPath(req.Path)
	if err != nil || real == "/" {
		common.ErrorResp(c, errs.PermissionDenied, 403)
		return
	}
	entry, err := followFor(c.Request.Context(), real)
	if err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	s := follows()
	s.mu.Lock()
	if i := s.find(real); i >= 0 {
		entry.Requested = s.items[i].Requested
		s.items[i] = entry
	} else {
		s.items = append(s.items, entry)
	}
	s.saveLocked()
	s.mu.Unlock()
	if shown, ok := user.ShowPath(real); ok {
		entry.Path = shown
	}
	entry.Requested = nil
	common.SuccessResp(c, gin.H{"item": entry})
}

// TgvioFollowRemove: POST /api/tgvio/follow/remove {path}
func TgvioFollowRemove(c *gin.Context) {
	var req followReq
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorStrResp(c, "path is required", 400)
		return
	}
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	real, err := user.JoinPath(req.Path)
	if err != nil {
		common.ErrorResp(c, errs.PermissionDenied, 403)
		return
	}
	s := follows()
	s.mu.Lock()
	if i := s.find(real); i >= 0 {
		s.items = append(s.items[:i], s.items[i+1:]...)
		s.saveLocked()
	}
	s.mu.Unlock()
	common.SuccessResp(c)
}

// TgvioFollowCheck: POST /api/tgvio/follow/check — look now.
func TgvioFollowCheck(c *gin.Context) {
	parts, err := checkFollows(c.Request.Context(), true)
	if err != nil {
		common.ErrorResp(c, err, 500)
		return
	}
	common.SuccessResp(c, gin.H{"parts": parts})
}

// followFor: the series a folder belongs to, and its title on the resource site.
func followFor(ctx context.Context, dir string) (followEntry, error) {
	parent, base := stdpath.Dir(dir), stdpath.Base(dir)
	found, _ := posters().Lookup(parent, []string{base})
	p := found[base]
	if p == nil || p.None || p.Kind != "tv" {
		return followEntry{}, fmt.Errorf("这不是剧集的季文件夹")
	}
	season := p.Season
	if season == 0 {
		season = tgvio.SeasonOf(base)
	}
	details, err := posters().Details(ctx, "tv", p.ID)
	if err != nil || details == nil || details.None {
		return followEntry{}, fmt.Errorf("读不到这个剧的资料")
	}
	site := ""
	for _, s := range resourceSites().Config().Sites {
		if s.Enabled && s.Reader != "" {
			site = s.ID
			break
		}
	}
	if site == "" {
		return followEntry{}, fmt.Errorf("没有可用的资源站")
	}
	query := strings.TrimSpace(yearSuffix.ReplaceAllString(base, ""))
	if query == "" {
		query = details.Title
	}
	reader, err := resourceSites().ReaderFor(site)
	if err != nil {
		return followEntry{}, err
	}
	titles, err := reader.Titles(ctx, query)
	if err != nil {
		return followEntry{}, err
	}
	best := pickResourceTitle(titles, details.Title, query, details.Year)
	if best == nil {
		return followEntry{}, fmt.Errorf("资源站上没有找到「%s」", query)
	}
	return followEntry{Path: dir, TMDb: p.ID, Title: details.Title, Season: season,
		Site: site, SeedTitle: best.ID, Query: query, At: time.Now().Unix()}, nil
}

var yearSuffix = regexp.MustCompile(`\s*[（(]\s*(?:19|20)\d{2}\s*[)）]\s*$`)

// pickResourceTitle: the site's title that is this series (its own name, or
// the season's name), never a film beside it.
func pickResourceTitle(titles []tgvio.ResourceTitle, series, query string, year int) *tgvio.ResourceTitle {
	want := normalizeNames(series)
	whole := normalizeNames(query)
	for i := range titles {
		t := &titles[i]
		got := normalizeNames(t.Title)
		if got == "" {
			continue
		}
		if got == whole || strings.HasPrefix(got, want) && strings.Contains(got, "季") {
			return t
		}
		if year > 0 && t.Year > 0 && (t.Year-year > 2 || year-t.Year > 2) {
			continue
		}
		if got == want {
			return t
		}
	}
	for i := range titles {
		if strings.HasPrefix(normalizeNames(titles[i].Title), want) && want != "" {
			return &titles[i]
		}
	}
	return nil
}

func normalizeNames(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if r >= '0' && r <= '9' || r >= 'a' && r <= 'z' || r >= 0x4e00 && r <= 0x9fff {
			b.WriteRune(r)
		}
	}
	return b.String()
}

var episodeInName = regexp.MustCompile(`(?i)S(\d{1,2})E(\d{1,4})`)

// checkFollows: for every followed season, the site's releases the library
// does not have yet go into the download folder.
func checkFollows(ctx context.Context, force bool) ([]string, error) {
	cfg := resourceSites().Config()
	if !cfg.Enabled {
		return nil, nil
	}
	s := follows()
	s.mu.Lock()
	items := make([]followEntry, len(s.items))
	copy(items, s.items)
	s.mu.Unlock()
	if len(items) == 0 {
		return nil, nil
	}
	parts := []string{}
	now := time.Now().Unix()
	for i := range items {
		it := &items[i]
		reader, err := resourceSites().ReaderFor(it.Site)
		if err != nil {
			continue
		}
		seeds, err := reader.Seeds(ctx, it.SeedTitle)
		if err != nil {
			log.Warnf("tgvio follow %s: %v", it.Title, err)
			continue
		}
		have := map[[2]int]bool{}
		objs, err := fs.List(ctx, it.Path, &fs.ListArgs{Refresh: true})
		if err == nil {
			for _, o := range objs {
				if m := episodeInName.FindStringSubmatch(o.GetName()); m != nil {
					season, _ := strconv.Atoi(m[1])
					ep, _ := strconv.Atoi(m[2])
					have[[2]int{season, ep}] = true
				}
			}
		}
		counts := seasonCounts(ctx, it.TMDb)
		for _, seed := range seeds {
			season, ep := tgvio.ParseEpisode(seed.Title)
			if ep == 0 {
				continue
			}
			season, ep = placeInSeason(counts, season, ep)
			if it.Season > 0 && season != it.Season {
				continue
			}
			if have[[2]int{season, ep}] {
				continue
			}
			if at, ok := it.Requested[seed.ID]; ok && now-at < 3*24*3600 && !force {
				continue
			}
			magnet, err := reader.Magnet(ctx, seed.ID)
			if err != nil || magnet == "" {
				continue
			}
			if _, err := tool.AddURL(ctx, &tool.AddURLArgs{URL: magnet, DstDirPath: cfg.Folder, Tool: "115 Cloud"}); err != nil {
				log.Warnf("tgvio follow %s: %v", seed.Title, err)
				continue
			}
			if it.Requested == nil {
				it.Requested = map[string]int64{}
			}
			it.Requested[seed.ID] = now
			parts = append(parts, fmt.Sprintf("%s S%02dE%02d", it.Title, season, ep))
			log.Infof("tgvio follow: %s -> S%02dE%02d (%s)", it.Title, season, ep, seed.Title)
			if len(parts) >= 8 {
				break
			}
		}
	}
	s.mu.Lock()
	for i := range items {
		if j := s.find(items[i].Path); j >= 0 && items[i].Requested != nil {
			s.items[j].Requested = items[i].Requested
		}
	}
	s.saveLocked()
	s.mu.Unlock()
	return parts, nil
}

func seasonCounts(ctx context.Context, id int) map[int]int {
	out := map[int]int{}
	seasons, err := posters().Seasons(ctx, id)
	if err != nil {
		return out
	}
	for _, s := range seasons {
		out[s.Season] = s.Episodes
	}
	return out
}

// placeInSeason: a release numbering on from the series' first episode
// ("Season 2 - 176") is that season's own number.
func placeInSeason(counts map[int]int, season, ep int) (int, int) {
	if n := counts[season]; season > 1 && n > 0 && ep > n {
		before := 0
		for s := 1; s < season; s++ {
			before += counts[s]
		}
		if ep > before && ep-before <= n {
			return season, ep - before
		}
	}
	return season, ep
}

var lastFollowCheck = time.Now()

// autoCheckFollows: every six hours the followed seasons are looked at.
func autoCheckFollows(ctx context.Context) {
	if time.Since(lastFollowCheck) < 6*time.Hour {
		return
	}
	lastFollowCheck = time.Now()
	if _, err := checkFollows(ctx, false); err != nil {
		log.Warnf("tgvio follow: %v", err)
	}
}
