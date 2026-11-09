package handles

import (
	"context"
	"io"
	"net/http"
	stdpath "path"
	"strings"

	"github.com/OpenListTeam/OpenList/v4/internal/errs"
	"github.com/OpenListTeam/OpenList/v4/internal/fs"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/internal/tgvio"
	"github.com/OpenListTeam/OpenList/v4/pkg/http_range"
	"github.com/OpenListTeam/OpenList/v4/pkg/utils"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
)

// TGVIO: subtitles inside a share, for a visitor without an account. The files
// beside the video are read here (a share's storage need not allow the web
// proxy, and a browser cannot read a redirect to the drive); 射手网 can be
// searched too, and a chosen subtitle comes back as text to play from memory —
// a visitor never writes into the share.

const subtitleTextLimit = 8 << 20

type shareSubtitleReq struct {
	Share    string `json:"share"`
	SharePwd string `json:"share_pwd"`
	Path     string `json:"path"` // the video, relative to the share
	Query    string `json:"q"`
	ID       int    `json:"id"`
	File     string `json:"file"`
	Lang     string `json:"lang"`
}

// shareSubtitleScope validates the share and the video inside it.
func shareSubtitleScope(sid, pwd, path string) (*shareScope, string, error) {
	s, err := op.GetSharingById(sid)
	if err != nil {
		return nil, "", errs.SharingNotFound
	}
	if !s.Valid() {
		return nil, "", errs.InvalidSharing
	}
	if !s.Verify(pwd) {
		return nil, "", errs.WrongShareCode
	}
	scope := &shareScope{sharing: s, pwd: pwd}
	real, err := op.GetSharingUnwrapPath(s, utils.FixAndCleanPath(path))
	if err != nil || !scope.mayOpen(real) {
		return nil, "", errors.New("password is incorrect or you have no permission")
	}
	return scope, real, nil
}

// readText reads a small file through its storage: the link's URL when the
// driver gives one, its reader otherwise (a local disk, an archive).
func readText(ctx context.Context, realPath string) ([]byte, error) {
	obj, err := fs.Get(ctx, realPath, &fs.GetArgs{NoLog: true})
	if err != nil {
		return nil, err
	}
	if obj.IsDir() {
		return nil, errors.New("not a file")
	}
	if obj.GetSize() > subtitleTextLimit {
		return nil, errors.New("file too large for a subtitle")
	}
	link, _, err := fs.Link(ctx, realPath, model.LinkArgs{})
	if err != nil {
		return nil, err
	}
	defer link.Close()
	var body io.ReadCloser
	if link.URL != "" {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, link.URL, nil)
		if err != nil {
			return nil, err
		}
		for key, values := range link.Header {
			for _, value := range values {
				req.Header.Add(key, value)
			}
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return nil, err
		}
		if resp.StatusCode >= http.StatusBadRequest {
			resp.Body.Close()
			return nil, errors.Errorf("the drive answered %d", resp.StatusCode)
		}
		body = resp.Body
	} else if link.RangeReader != nil {
		reader, err := link.RangeReader.RangeRead(ctx, http_range.Range{Length: -1})
		if err != nil {
			return nil, err
		}
		body = reader
	} else {
		return nil, errors.New("this file cannot be read")
	}
	defer body.Close()
	data, err := io.ReadAll(io.LimitReader(body, subtitleTextLimit+1))
	if err != nil {
		return nil, err
	}
	if len(data) > subtitleTextLimit {
		return nil, errors.New("file too large for a subtitle")
	}
	return data, nil
}

// TgvioShareSubtitle: GET /api/tgvio/share/subtitle?share=&share_pwd=&path=
// The text of a subtitle inside the share, named as the share shows it.
func TgvioShareSubtitle(c *gin.Context) {
	share, err := shareOf(c) // the query form: share, share_pwd
	if err != nil {
		shareErrorResp(c, err)
		return
	}
	p := utils.FixAndCleanPath(c.Query("path"))
	real, err := op.GetSharingUnwrapPath(share.sharing, p)
	if err != nil || !share.mayOpen(real) {
		common.ErrorStrResp(c, "password is incorrect or you have no permission", 403)
		return
	}
	data, err := readText(c.Request.Context(), real)
	if err != nil {
		common.ErrorResp(c, err, 502)
		return
	}
	c.Header("Cache-Control", "private, max-age=300")
	c.Data(http.StatusOK, "text/plain; charset=utf-8", data)
}

// shareSubtitleBody is the POST form of the same validation.
func shareSubtitleBody(c *gin.Context, req *shareSubtitleReq) (*shareScope, string, bool) {
	if req.Share == "" {
		common.ErrorStrResp(c, "share is required", 400)
		return nil, "", false
	}
	scope, real, err := shareSubtitleScope(req.Share, req.SharePwd, req.Path)
	if err != nil {
		switch {
		case errors.Is(err, errs.SharingNotFound):
			common.ErrorStrResp(c, "the share does not exist", 404)
		case errors.Is(err, errs.InvalidSharing):
			common.ErrorStrResp(c, "the share has expired or is no longer valid", 410)
		case errors.Is(err, errs.WrongShareCode):
			common.ErrorResp(c, err, 403)
		default:
			common.ErrorStrResp(c, "password is incorrect or you have no permission", 403)
		}
		return nil, "", false
	}
	return scope, real, true
}

// TgvioShareSubtitlesSearch: POST /api/tgvio/share/subtitles/search
// {share, share_pwd, path, q} — 射手网 results for a video in the share.
func TgvioShareSubtitlesSearch(c *gin.Context) {
	var req shareSubtitleReq
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	_, real, ok := shareSubtitleBody(c, &req)
	if !ok {
		return
	}
	results, err := subtitles().Search(c.Request.Context(), stdpath.Base(real), req.Query)
	if err != nil {
		common.ErrorResp(c, err, 502)
		return
	}
	common.SuccessResp(c, gin.H{"items": results})
}

// TgvioShareSubtitlesFiles: POST /api/tgvio/share/subtitles/files {share, share_pwd, id}
func TgvioShareSubtitlesFiles(c *gin.Context) {
	var req shareSubtitleReq
	if err := c.ShouldBindJSON(&req); err != nil || req.ID <= 0 {
		common.ErrorStrResp(c, "id is required", 400)
		return
	}
	if _, _, ok := shareSubtitleBody(c, &req); !ok {
		return
	}
	files, err := subtitles().Files(c.Request.Context(), req.ID)
	if err != nil {
		common.ErrorResp(c, err, 502)
		return
	}
	common.SuccessResp(c, gin.H{"items": files})
}

// TgvioShareSubtitlesText: POST /api/tgvio/share/subtitles/text
// {share, share_pwd, path, id, file} — the subtitle's text, to play in memory.
func TgvioShareSubtitlesText(c *gin.Context) {
	var req shareSubtitleReq
	if err := c.ShouldBindJSON(&req); err != nil || req.ID <= 0 || strings.TrimSpace(req.File) == "" {
		common.ErrorStrResp(c, "id and file are required", 400)
		return
	}
	if _, _, ok := shareSubtitleBody(c, &req); !ok {
		return
	}
	data, err := subtitles().Download(c.Request.Context(), req.ID, req.File)
	if err != nil {
		common.ErrorResp(c, err, 502)
		return
	}
	name := tgvio.SubtitleName(stdpath.Base(req.Path), req.File, req.Lang)
	common.SuccessResp(c, gin.H{"name": name, "text": string(data)})
}
