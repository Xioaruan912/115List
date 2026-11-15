package handles

import (
	"context"
	"fmt"
	stdpath "path"
	"regexp"
	"strings"

	_115 "github.com/OpenListTeam/OpenList/v4/drivers/115"
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

// share115 resolves the request: the 115 storage of the folder, its real path
// and the folder as the user (and the library) knows it.
func share115(c *gin.Context, req *shareReq, write bool) (*_115.Pan115, string, string, string, string, bool) {
	code, pass, ok := parseShareLink(req.Link)
	if !ok {
		common.ErrorStrResp(c, "not a 115 share link", 400)
		return nil, "", "", "", "", false
	}
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	reqPath, err := user.JoinPath(req.Path)
	if err != nil {
		common.ErrorResp(c, err, 403)
		return nil, "", "", "", "", false
	}
	if write {
		meta, err := op.GetNearestMeta(reqPath)
		if err != nil && !errors.Is(errors.Cause(err), errs.MetaNotFound) {
			common.ErrorResp(c, err, 500, true)
			return nil, "", "", "", "", false
		}
		if !common.CanWrite(user, meta, reqPath) {
			common.ErrorResp(c, errs.PermissionDenied, 403)
			return nil, "", "", "", "", false
		}
	}
	storage, actual, err := op.GetStorageAndActualPath(reqPath)
	if err != nil {
		common.ErrorResp(c, err, 400)
		return nil, "", "", "", "", false
	}
	pan, ok := storage.(*_115.Pan115)
	if !ok {
		common.ErrorStrResp(c, "this folder is not on a 115 storage", 400)
		return nil, "", "", "", "", false
	}
	return pan, actual, reqPath, code, pass, true
}

// Tgvio115SharePeek: POST /api/tgvio/115/share/peek {link, path, dir}
func Tgvio115SharePeek(c *gin.Context) {
	var req shareReq
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	pan, _, _, code, pass, ok := share115(c, &req, false)
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

// shareFolderName names the folder a share of loose files is received into:
// the release's own name ("Other.Mommy.2026.2160p…"), which the organizer
// reads and renames to the title.
func shareFolderName(title string, items []_115.ShareItem) string {
	name := ""
	for _, item := range items {
		if !item.IsDir && tgvio.IsVideo(item.Name) {
			name = item.Name
			break
		}
	}
	if name == "" {
		name = title
	}
	name = tgvio.SafeName(tgvio.VideoStem(name))
	if r := []rune(name); len(r) > 100 {
		name = strings.TrimSpace(string(r[:100]))
	}
	return strings.TrimRight(strings.TrimSpace(name), ".")
}

// receiveShare copies a share's chosen items into libDir (the folder as the
// user sees it). Files saved straight into a library root get a folder of
// their own first — 影视库/Other.Mommy…/Other.Mommy….mkv, which the organizer
// turns into 影视库/另一个妈妈 (2026)/… — so a title does not lie bare in the
// root where neither the library nor the organizer would see it. It returns
// the names now in libDir (for the poster store and the organizer) and the
// folder it made, if any.
func receiveShare(ctx context.Context, pan *_115.Pan115, actual, libDir, code, pass string, ids []string, snap *_115.ShareSnapshot) (landed []string, made string, err error) {
	want := make(map[string]bool, len(ids))
	for _, id := range ids {
		want[id] = true
	}
	chosen := make([]_115.ShareItem, 0, len(ids))
	for _, item := range snap.Items {
		if want[item.ID] {
			chosen = append(chosen, item)
		}
	}
	names := make([]string, 0, len(chosen))
	loose, video := len(chosen) > 0, false
	for _, item := range chosen {
		names = append(names, item.Name)
		if item.IsDir {
			loose = false
		} else if tgvio.IsVideo(item.Name) {
			video = true
		}
	}
	dstActual, dstDir := actual, libDir
	if loose && video && isLibraryRoot(libDir) {
		base := shareFolderName(snap.Title, chosen)
		name := base
		for n := 2; name != "" && n < 50; n++ {
			folder := stdpath.Join(libDir, name)
			if obj, _ := fs.Get(ctx, folder, &fs.GetArgs{NoLog: true}); obj != nil {
				name = fmt.Sprintf("%s (%d)", base, n)
				continue
			}
			if err := fs.MakeDir(ctx, folder); err != nil {
				break
			}
			if obj, err := fs.Get(ctx, folder, &fs.GetArgs{NoLog: true}); err == nil && obj.IsDir() {
				dstActual, dstDir, made = stdpath.Join(actual, name), folder, name
				names = []string{name}
			}
			break
		}
	}
	dst, err := op.GetUnwrap(ctx, pan, dstActual)
	if err != nil {
		return nil, "", err
	}
	if !dst.IsDir() {
		return nil, "", errs.NotFolder
	}
	if err := pan.ShareReceive(ctx, code, pass, ids, dst.GetID()); err != nil {
		if made != "" {
			_ = fs.Remove(ctx, stdpath.Join(libDir, made))
		}
		return nil, "", err
	}
	op.Cache.DeleteDirectory(pan, actual) // the next listing shows what arrived
	if dstActual != actual {
		op.Cache.DeleteDirectory(pan, dstActual)
	}
	if len(names) > 0 {
		_, _ = posters().Lookup(dstDir, names)
	}
	return names, made, nil
}

// noteShareLanded hands what a share just saved to the poster store's next
// look and to the organizer (a folder at once), so 影视库 shows it without
// waiting for the ten-minute root scan.
func noteShareLanded(ctx context.Context, libDir string, landed []string, made string) {
	for _, name := range landed {
		path := stdpath.Join(libDir, name)
		if name == made {
			_ = organizeStore().Mark(path, true)
			continue
		}
		if obj, err := fs.Get(ctx, path, &fs.GetArgs{NoLog: true}); err == nil && obj.IsDir() {
			_ = organizeStore().Mark(path, true)
		}
	}
	KickAutoOrganize()
}

// receiveShareLink: a 115 share link pasted as a download URL is a transfer,
// not something to fetch (fetching it only saves the share page). handled is
// false when the link or the destination is not a 115 share on 115's drive.
func receiveShareLink(ctx context.Context, libDir, link string) (saved int, handled bool, err error) {
	code, pass, ok := parseShareLink(link)
	if !ok {
		return 0, false, nil
	}
	storage, actual, err := op.GetStorageAndActualPath(libDir)
	if err != nil {
		return 0, false, nil
	}
	pan, ok := storage.(*_115.Pan115)
	if !ok {
		return 0, false, nil
	}
	snap, err := pan.ShareSnap(ctx, code, pass, "")
	if err != nil {
		return 0, true, err
	}
	if len(snap.Items) == 0 {
		return 0, true, fmt.Errorf("115 share: nothing there")
	}
	ids := make([]string, 0, len(snap.Items))
	for _, item := range snap.Items {
		ids = append(ids, item.ID)
	}
	landed, made, err := receiveShare(ctx, pan, actual, libDir, code, pass, ids, snap)
	if err != nil {
		return 0, true, err
	}
	noteShareLanded(ctx, libDir, landed, made)
	return len(ids), true, nil
}

// Tgvio115ShareSave: POST /api/tgvio/115/share/save {link, path, ids}
func Tgvio115ShareSave(c *gin.Context) {
	var req shareReq
	if err := c.ShouldBindJSON(&req); err != nil || len(req.IDs) == 0 || len(req.IDs) > 500 {
		common.ErrorStrResp(c, "choose 1 to 500 items", 400)
		return
	}
	pan, actual, reqPath, code, pass, ok := share115(c, &req, true)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	snap, err := pan.ShareSnap(ctx, code, pass, req.Dir)
	if err != nil {
		common.ErrorResp(c, err, 502)
		return
	}
	landed, made, err := receiveShare(ctx, pan, actual, reqPath, code, pass, req.IDs, snap)
	if err != nil {
		common.ErrorResp(c, err, 502)
		return
	}
	noteShareLanded(ctx, reqPath, landed, made)
	common.SuccessResp(c, gin.H{"saved": len(req.IDs)})
}
