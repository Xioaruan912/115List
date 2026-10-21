package handles

import (
	"context"
	stdpath "path"
	"strconv"
	"strings"

	"github.com/OpenListTeam/OpenList/v4/cmd/flags"
	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/errs"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/internal/tgvio"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
)

// TGVIO: search without OpenList's drive-crawling index. Names come from the
// folders anyone has opened (internal/tgvio/names.go, fed by the listing hook)
// and titles from the poster store, so "星际穿越" finds Interstellar.2014.mkv.

func names() *tgvio.NameIndex { return tgvio.Names(flags.DataDir) }

func init() {
	op.RegisterObjsUpdateHook(func(_ context.Context, parent string, objs []model.Obj) {
		entries := make([]tgvio.NameEntry, 0, len(objs))
		for _, obj := range objs {
			entries = append(entries, tgvio.NameEntry{Name: obj.GetName(), Dir: obj.IsDir(), Size: obj.GetSize()})
		}
		names().Record(parent, entries)
	})
}

type searchHit struct {
	Parent string     `json:"parent"`
	Name   string     `json:"name"`
	IsDir  bool       `json:"is_dir"`
	Size   int64      `json:"size,omitempty"`
	Poster *posterOut `json:"poster,omitempty"` // matched by its TMDB title
}

// TgvioSearch: GET /api/tgvio/search?q=&limit= searches names and TMDB titles
// in what the user may open without a password, under the paths they see.
func TgvioSearch(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit <= 0 || limit > 200 {
		limit = 60
	}
	if len([]rune(q)) < 1 {
		common.ErrorStrResp(c, "q is required", 400)
		return
	}
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	allowed := map[string]bool{}
	mayOpen := func(dir string) bool {
		if ok, seen := allowed[dir]; seen {
			return ok
		}
		ok := false
		if _, inside := user.ShowPath(dir); inside {
			meta, err := op.GetNearestMeta(dir)
			ok = (err == nil || errors.Is(errors.Cause(err), errs.MetaNotFound)) && webCanAccess(user, meta, dir, "")
		}
		allowed[dir] = ok
		return ok
	}
	shown := func(real string) string { out, _ := user.ShowPath(real); return out }

	out := []searchHit{}
	seen := map[string]bool{}
	// Titles first: a film found by its Chinese name though its file is in English.
	words := strings.Fields(tgvio.Fold(q))
	for _, entry := range posters().Library() {
		title := tgvio.Fold(entry.Title + " " + entry.Original)
		match := len(words) > 0
		for _, w := range words {
			if !strings.Contains(title, w) {
				match = false
				break
			}
		}
		if !match || !posters().InLibrary(entry.Dir) || !mayOpen(entry.Dir) || libraryExtras.MatchString(entry.Name) {
			continue
		}
		real := stdpath.Join(entry.Dir, entry.Name)
		if seen[real] || len(out) >= limit/3 {
			continue
		}
		seen[real] = true
		p := entry
		out = append(out, searchHit{Parent: shown(entry.Dir), Name: entry.Name, IsDir: !tgvio.IsMediaFile(entry.Name), Poster: toPosterOut(&p)})
	}
	for _, hit := range names().Search(q, limit, mayOpen) {
		real := stdpath.Join(hit.Parent, hit.Name)
		if seen[real] || len(out) >= limit {
			continue
		}
		seen[real] = true
		out = append(out, searchHit{Parent: shown(hit.Parent), Name: hit.Name, IsDir: hit.Dir, Size: hit.Size})
	}
	common.SuccessResp(c, gin.H{"items": out, "folders": names().Folders()})
}
