package handles

import (
	"bytes"
	stdpath "path"
	"strings"
	"time"

	"github.com/OpenListTeam/OpenList/v4/cmd/flags"
	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/errs"
	"github.com/OpenListTeam/OpenList/v4/internal/fs"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/internal/stream"
	"github.com/OpenListTeam/OpenList/v4/internal/tgvio"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
)

// TGVIO: subtitles from 射手网 (internal/tgvio/assrt.go) for a video without
// one: search, pick a file, and it is saved beside the video.

func subtitles() *tgvio.Assrt { return tgvio.Subtitles(flags.DataDir) }

// TgvioSubtitlesStatus: GET /api/tgvio/subtitles/status
func TgvioSubtitlesStatus(c *gin.Context) {
	common.SuccessResp(c, gin.H{"enabled": subtitles().Enabled()})
}

type subtitleReq struct {
	Path     string `json:"path"` // the video, as the user sees it
	Password string `json:"password"`
	Query    string `json:"q"`
	ID       int    `json:"id"`
	File     string `json:"file"`
	Lang     string `json:"lang"`
}

// subtitleVideo checks the user may read (and for saving, write) the video's
// folder and returns the video's real path.
func subtitleVideo(c *gin.Context, req *subtitleReq, write bool) (string, bool) {
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	reqPath, err := user.JoinPath(req.Path)
	if err != nil || reqPath == "/" {
		common.ErrorResp(c, errs.PermissionDenied, 403)
		return "", false
	}
	dir := stdpath.Dir(reqPath)
	meta, err := op.GetNearestMeta(dir)
	if err != nil && !errors.Is(errors.Cause(err), errs.MetaNotFound) {
		common.ErrorResp(c, err, 500, true)
		return "", false
	}
	if !webCanAccess(user, meta, dir, req.Password) {
		common.ErrorStrResp(c, "password is incorrect or you have no permission", 403)
		return "", false
	}
	if write && !common.CanWrite(user, meta, dir) {
		common.ErrorResp(c, errs.PermissionDenied, 403)
		return "", false
	}
	return reqPath, true
}

// TgvioSubtitlesSearch: POST /api/tgvio/subtitles/search {path, q}
func TgvioSubtitlesSearch(c *gin.Context) {
	var req subtitleReq
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	reqPath, ok := subtitleVideo(c, &req, false)
	if !ok {
		return
	}
	results, err := subtitles().Search(c.Request.Context(), stdpath.Base(reqPath), req.Query)
	if err != nil {
		common.ErrorResp(c, err, 502)
		return
	}
	common.SuccessResp(c, gin.H{"items": results})
}

// TgvioSubtitlesFiles: POST /api/tgvio/subtitles/files {id}
func TgvioSubtitlesFiles(c *gin.Context) {
	var req subtitleReq
	if err := c.ShouldBindJSON(&req); err != nil || req.ID <= 0 {
		common.ErrorStrResp(c, "id is required", 400)
		return
	}
	files, err := subtitles().Files(c.Request.Context(), req.ID)
	if err != nil {
		common.ErrorResp(c, err, 502)
		return
	}
	common.SuccessResp(c, gin.H{"items": files})
}

// TgvioSubtitlesSave: POST /api/tgvio/subtitles/save {path, id, file, lang}
// downloads the file and saves it beside the video, never over an existing file.
func TgvioSubtitlesSave(c *gin.Context) {
	var req subtitleReq
	if err := c.ShouldBindJSON(&req); err != nil || req.ID <= 0 || req.File == "" {
		common.ErrorStrResp(c, "id and file are required", 400)
		return
	}
	reqPath, ok := subtitleVideo(c, &req, true)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	data, err := subtitles().Download(ctx, req.ID, req.File)
	if err != nil {
		common.ErrorResp(c, err, 502)
		return
	}
	dir := stdpath.Dir(reqPath)
	name := tgvio.SubtitleName(stdpath.Base(reqPath), req.File, req.Lang)
	if obj, _ := fs.Get(ctx, stdpath.Join(dir, name), &fs.GetArgs{NoLog: true}); obj != nil {
		ext := stdpath.Ext(name)
		name = strings.TrimSuffix(name, ext) + ".assrt" + ext
	}
	file := &stream.FileStream{
		Obj:      &model.Object{Name: name, Size: int64(len(data)), Modified: time.Now()},
		Reader:   bytes.NewReader(data),
		Mimetype: "text/plain",
	}
	if err := fs.PutDirectly(ctx, dir, file); err != nil {
		common.ErrorResp(c, err, 500)
		return
	}
	common.SuccessResp(c, gin.H{"name": name})
}

type subtitleAdminReq struct {
	Token *string `json:"token"`
}

// TgvioSubtitlesAdmin: GET/POST /api/admin/tgvio/subtitles {token}
func TgvioSubtitlesAdmin(c *gin.Context) {
	if c.Request.Method == "POST" {
		var req subtitleAdminReq
		if err := c.ShouldBindJSON(&req); err != nil {
			common.ErrorResp(c, err, 400)
			return
		}
		if req.Token != nil {
			if err := subtitles().SetToken(*req.Token); err != nil {
				common.ErrorResp(c, err, 500)
				return
			}
		}
	}
	common.SuccessResp(c, gin.H{"token_set": subtitles().Enabled(), "token_hint": subtitles().TokenHint()})
}

// TgvioSubtitlesTest: POST /api/admin/tgvio/subtitles/test
func TgvioSubtitlesTest(c *gin.Context) {
	quota, err := subtitles().Quota(c.Request.Context())
	if err != nil {
		common.ErrorResp(c, err, 502)
		return
	}
	common.SuccessResp(c, gin.H{"quota": quota})
}
