package handles

import (
	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/errs"
	"github.com/OpenListTeam/OpenList/v4/internal/fs"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/internal/tgvio"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
)

// TGVIO: the series page of a folder (internal/tgvio/series.go). One cached
// listing of the folder, then the poster store and TMDB only.

type seriesEpisodeOut struct {
	tgvio.SeriesEpisode
	Still string `json:"still,omitempty"`
}

type seriesSeasonOut struct {
	tgvio.SeriesSeason
	Poster string `json:"poster,omitempty"`
}

type seriesReq struct {
	Path     string `json:"path"`
	Password string `json:"password"`
}

// TgvioSeries: POST /api/tgvio/series {path, password} → {series: null} when
// the folder is no TV series.
func TgvioSeries(c *gin.Context) {
	var req seriesReq
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	reqPath, err := user.JoinPath(req.Path)
	if err != nil {
		common.ErrorResp(c, err, 403)
		return
	}
	meta, err := op.GetNearestMeta(reqPath)
	if err != nil && !errors.Is(errors.Cause(err), errs.MetaNotFound) {
		common.ErrorResp(c, err, 500, true)
		return
	}
	if !webCanAccess(user, meta, reqPath, req.Password) {
		common.ErrorStrResp(c, "password is incorrect or you have no permission", 403)
		return
	}
	objs, err := fs.List(c.Request.Context(), reqPath, &fs.ListArgs{})
	if err != nil {
		common.ErrorResp(c, err, 500)
		return
	}
	entries := make([]tgvio.RenameEntry, 0, len(objs))
	for _, obj := range objs {
		entries = append(entries, tgvio.RenameEntry{Name: obj.GetName(), IsDir: obj.IsDir(), Size: obj.GetSize()})
	}
	view, err := posters().Series(c.Request.Context(), reqPath, entries)
	if err != nil {
		common.ErrorResp(c, err, 502)
		return
	}
	if view == nil {
		common.SuccessResp(c, gin.H{"series": nil})
		return
	}
	episodes := make([]seriesEpisodeOut, 0, len(view.Episodes))
	for _, e := range view.Episodes {
		episodes = append(episodes, seriesEpisodeOut{SeriesEpisode: e, Still: posterURL("w300", e.Still)})
	}
	seasons := make([]seriesSeasonOut, 0, len(view.Seasons))
	for _, s := range view.Seasons {
		seasons = append(seasons, seriesSeasonOut{SeriesSeason: s, Poster: posterURL("w185", s.Poster)})
	}
	root := ""
	if real := posters().SeriesRoot(reqPath, view); real != "" {
		root, _ = user.ShowPath(real)
	}
	common.SuccessResp(c, gin.H{"series": gin.H{
		"base": toPosterOut(view.Base), "subject": toPosterOut(view.Subject), "season": view.Season,
		"seasons": seasons, "episodes": episodes, "extra": view.Extra, "root": root,
	}})
}
