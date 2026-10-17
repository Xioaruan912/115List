package handles

import (
	"regexp"
	"strings"

	_115 "github.com/OpenListTeam/OpenList/v4/drivers/115"
	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/errs"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
)

// TGVIO: save a 115 share link into a 115 folder (转存), through the account of
// the storage the folder is on. Peek lists the share; save copies the chosen
// items. The user needs write access to the folder.

var (
	shareCodeRe = regexp.MustCompile(`(?i)(?:115(?:cdn)?\.com|anxia\.com)/s/([a-z0-9]+)`)
	sharePassRe = regexp.MustCompile(`(?i)(?:password=|pwd=|提取码|访问码|密码)[\s:：=]*([a-z0-9]{4})\b`)
	shareTailRe = regexp.MustCompile(`^[#?]([a-zA-Z0-9]{4})(?:[^a-zA-Z0-9]|$)`)
)

// parseShareLink reads a share code and its receive code from a pasted link or message.
func parseShareLink(text string) (code, pass string, ok bool) {
	m := shareCodeRe.FindStringSubmatch(text)
	if m == nil {
		return "", "", false
	}
	if p := sharePassRe.FindStringSubmatch(text); p != nil {
		pass = strings.ToLower(p[1])
	} else if i := strings.Index(text, m[0]); i >= 0 {
		// "115.com/s/abc#wxyz" and "…/s/abc?wxyz"
		if t := shareTailRe.FindStringSubmatch(text[i+len(m[0]):]); t != nil {
			pass = strings.ToLower(t[1])
		}
	}
	return m[1], pass, true
}

type shareReq struct {
	Link string   `json:"link"`
	Path string   `json:"path"` // the 115 folder it goes into, as the user sees it
	Dir  string   `json:"dir"`  // a folder inside the share to list ("" for its top)
	IDs  []string `json:"ids"`  // items to save
}

// share115 resolves the request: the 115 storage of the folder and its real path.
func share115(c *gin.Context, req *shareReq, write bool) (*_115.Pan115, string, string, string, bool) {
	code, pass, ok := parseShareLink(req.Link)
	if !ok {
		common.ErrorStrResp(c, "not a 115 share link", 400)
		return nil, "", "", "", false
	}
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	reqPath, err := user.JoinPath(req.Path)
	if err != nil {
		common.ErrorResp(c, err, 403)
		return nil, "", "", "", false
	}
	if write {
		meta, err := op.GetNearestMeta(reqPath)
		if err != nil && !errors.Is(errors.Cause(err), errs.MetaNotFound) {
			common.ErrorResp(c, err, 500, true)
			return nil, "", "", "", false
		}
		if !common.CanWrite(user, meta, reqPath) {
			common.ErrorResp(c, errs.PermissionDenied, 403)
			return nil, "", "", "", false
		}
	}
	storage, actual, err := op.GetStorageAndActualPath(reqPath)
	if err != nil {
		common.ErrorResp(c, err, 400)
		return nil, "", "", "", false
	}
	pan, ok := storage.(*_115.Pan115)
	if !ok {
		common.ErrorStrResp(c, "this folder is not on a 115 storage", 400)
		return nil, "", "", "", false
	}
	return pan, actual, code, pass, true
}

// Tgvio115SharePeek: POST /api/tgvio/115/share/peek {link, path, dir}
func Tgvio115SharePeek(c *gin.Context) {
	var req shareReq
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	pan, _, code, pass, ok := share115(c, &req, false)
	if !ok {
		return
	}
	snap, err := pan.ShareSnap(c.Request.Context(), code, pass, req.Dir)
	if err != nil {
		common.ErrorResp(c, err, 502)
		return
	}
	common.SuccessResp(c, gin.H{"code": code, "password": pass, "title": snap.Title, "count": snap.Count, "items": snap.Items})
}

// Tgvio115ShareSave: POST /api/tgvio/115/share/save {link, path, ids}
func Tgvio115ShareSave(c *gin.Context) {
	var req shareReq
	if err := c.ShouldBindJSON(&req); err != nil || len(req.IDs) == 0 || len(req.IDs) > 500 {
		common.ErrorStrResp(c, "choose 1 to 500 items", 400)
		return
	}
	pan, actual, code, pass, ok := share115(c, &req, true)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	dir, err := op.GetUnwrap(ctx, pan, actual)
	if err != nil {
		common.ErrorResp(c, err, 500)
		return
	}
	if !dir.IsDir() {
		common.ErrorResp(c, errs.NotFolder, 400)
		return
	}
	if err := pan.ShareReceive(ctx, code, pass, req.IDs, dir.GetID()); err != nil {
		common.ErrorResp(c, err, 502)
		return
	}
	op.Cache.DeleteDirectory(pan, actual) // the next listing shows what arrived
	common.SuccessResp(c, gin.H{"saved": len(req.IDs)})
}
