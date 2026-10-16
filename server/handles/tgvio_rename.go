package handles

import (
	"fmt"
	stdpath "path"
	"strings"
	"time"

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

// TGVIO: rename a folder's videos after TMDB (internal/tgvio/rename.go). The
// plan is shown first; applying renames one object at a time, through the same
// fs.Rename as the rename button, and the poster store follows the new names.

type renamePlanReq struct {
	Path     string `json:"path"`
	Password string `json:"password"`
}

// renameFolder checks that the user may rename inside a folder and returns its
// real path.
func renameFolder(c *gin.Context, path, password string) (string, bool) {
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	if !user.CanRename() {
		common.ErrorResp(c, errs.PermissionDenied, 403)
		return "", false
	}
	reqPath, err := user.JoinPath(path)
	if err != nil || reqPath == "/" {
		common.ErrorResp(c, errs.PermissionDenied, 403)
		return "", false
	}
	meta, err := op.GetNearestMeta(reqPath)
	if err != nil && !errors.Is(errors.Cause(err), errs.MetaNotFound) {
		common.ErrorResp(c, err, 500, true)
		return "", false
	}
	if !webCanAccess(user, meta, reqPath, password) {
		common.ErrorStrResp(c, "password is incorrect or you have no permission", 403)
		return "", false
	}
	if !common.CanWrite(user, meta, stdpath.Dir(reqPath)) {
		common.ErrorResp(c, errs.PermissionDenied, 403)
		return "", false
	}
	return reqPath, true
}

// TgvioRenamePlan: POST /api/tgvio/rename/plan {path} proposes TMDB names for
// the folder's videos, subtitles and the folder itself. One (cached) listing.
func TgvioRenamePlan(c *gin.Context) {
	var req renamePlanReq
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	reqPath, ok := renameFolder(c, req.Path, req.Password)
	if !ok {
		return
	}
	objs, err := fs.List(c.Request.Context(), reqPath, &fs.ListArgs{})
	if err != nil {
		common.ErrorResp(c, err, 500)
		return
	}
	entries := make([]tgvio.RenameEntry, 0, len(objs))
	for _, obj := range objs {
		entries = append(entries, tgvio.RenameEntry{Name: obj.GetName(), IsDir: obj.IsDir()})
	}
	plan, err := posters().PlanRename(c.Request.Context(), reqPath, entries)
	if err != nil {
		common.ErrorResp(c, err, 500)
		return
	}
	common.SuccessResp(c, gin.H{"subject": toPosterOut(plan.Subject), "items": plan.Items, "reason": plan.Reason})
}

type renameApplyItem struct {
	Old string `json:"old"`
	New string `json:"new"`
}

type renameApplyReq struct {
	Path     string            `json:"path"`
	Password string            `json:"password"`
	Items    []renameApplyItem `json:"items"`
	Folder   string            `json:"folder"` // the folder's new name, empty to keep it
}

type renameResult struct {
	Old   string `json:"old"`
	New   string `json:"new"`
	Error string `json:"error,omitempty"`
}

// TgvioRenameApply: POST /api/tgvio/rename/apply {path, items, folder} renames
// the chosen objects, one after another with a short pause (renames are drive
// writes), then the folder itself. Each row reports on its own.
func TgvioRenameApply(c *gin.Context) {
	var req renameApplyReq
	if err := c.ShouldBindJSON(&req); err != nil || len(req.Items) > 2000 {
		common.ErrorStrResp(c, "give up to 2000 renames", 400)
		return
	}
	reqPath, ok := renameFolder(c, req.Path, req.Password)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	store := posters()
	results := make([]renameResult, 0, len(req.Items)+1)
	rename := func(dir, oldName, newName string) error {
		if err := checkRelativePath(oldName); err != nil {
			return err
		}
		if err := checkRelativePath(newName); err != nil {
			return err
		}
		if strings.TrimSpace(newName) == "" || oldName == newName {
			return fmt.Errorf("nothing to rename")
		}
		if !strings.EqualFold(oldName, newName) {
			if res, _ := fs.Get(ctx, stdpath.Join(dir, newName), &fs.GetArgs{NoLog: true}); res != nil {
				return fmt.Errorf("file [%s] exists", newName)
			}
		}
		return fs.Rename(ctx, stdpath.Join(dir, oldName), newName)
	}
	for i, item := range req.Items {
		if i > 0 {
			time.Sleep(250 * time.Millisecond)
		}
		result := renameResult{Old: item.Old, New: item.New}
		if err := rename(reqPath, item.Old, item.New); err != nil {
			result.Error = err.Error()
		} else {
			store.Renamed(reqPath, item.Old, item.New, reqPath)
		}
		results = append(results, result)
	}
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	finalPath := reqPath
	if folder := strings.TrimSpace(req.Folder); folder != "" && folder != stdpath.Base(reqPath) {
		parent := stdpath.Dir(reqPath)
		result := renameResult{Old: stdpath.Base(reqPath), New: folder}
		if err := rename(parent, stdpath.Base(reqPath), folder); err != nil {
			result.Error = err.Error()
		} else {
			finalPath = stdpath.Join(parent, folder)
			store.Renamed(parent, stdpath.Base(reqPath), folder, parent)
			store.RenamedDir(reqPath, finalPath)
		}
		results = append(results, result)
	}
	shown, _ := user.ShowPath(finalPath)
	common.SuccessResp(c, gin.H{"results": results, "path": shown})
}
