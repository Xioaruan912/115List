package handles

import (
	"context"
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
	Path     string   `json:"path"`
	Password string   `json:"password"`
	Only     []string `json:"only"`   // chosen files: each named by its own match, folder name kept
	Season   int      `json:"season"` // name episodes under this season (0: from the folder)
	// Inherit: the folder above was planned as this (a subfolder of a series or film being renamed whole).
	Inherit *tgvio.RenameInherit `json:"inherit"`
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
	if !posters().InLibrary(reqPath) {
		common.ErrorStrResp(c, "this folder is outside the media library paths", 400)
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
		entries = append(entries, tgvio.RenameEntry{Name: obj.GetName(), IsDir: obj.IsDir(), Size: obj.GetSize()})
	}
	var plan *tgvio.RenamePlan
	if len(req.Only) > 0 {
		plan, err = posters().PlanFiles(c.Request.Context(), reqPath, entries, req.Only, req.Season)
	} else {
		plan, err = posters().PlanRenameIn(c.Request.Context(), reqPath, entries, req.Season, req.Inherit)
	}
	if err != nil {
		common.ErrorResp(c, err, 500)
		return
	}
	common.SuccessResp(c, gin.H{"subject": toPosterOut(plan.Subject), "season": plan.Season, "items": plan.Items, "reason": plan.Reason,
		"need": plan.Need, "inherited": plan.Inherited, "film": plan.Film,
		"shelf": plan.Shelf, "series_first": plan.SeriesFirst})
}

type renameTreeReq struct {
	Path     string `json:"path"`
	Password string `json:"password"`
}

type renameTreeFolder struct {
	Path  string `json:"path"`
	Depth int    `json:"depth"`
}

const (
	renameTreeDepth   = 4
	renameTreeFolders = 80
)

// TgvioRenameTree: POST /api/tgvio/rename/tree {path} lists the folder and the
// subfolders below it that hold videos or subtitles (a series' seasons, a
// "Subs" folder), parents first, up to four levels and 80 folders. Listings
// are the cached ones the browser uses.
func TgvioRenameTree(c *gin.Context) {
	var req renameTreeReq
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	reqPath, ok := renameFolder(c, req.Path, req.Password)
	if !ok {
		return
	}
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	folders, err := renameTreeOf(c.Request.Context(), reqPath, false)
	if err != nil {
		common.ErrorResp(c, err, 500)
		return
	}
	for i := range folders {
		folders[i].Path, _ = user.ShowPath(folders[i].Path)
	}
	common.SuccessResp(c, gin.H{"folders": folders})
}

// renameTreeOf lists the folder (real path) and the subfolders below it worth
// planning, parents first. refresh reads the drive again (downloads that just landed).
func renameTreeOf(ctx context.Context, reqPath string, refresh bool) ([]renameTreeFolder, error) {
	folders := []renameTreeFolder{{Path: reqPath, Depth: 0}}
	type level struct {
		path  string
		depth int
	}
	queue := []level{{reqPath, 0}}
	for len(queue) > 0 && len(folders) < renameTreeFolders {
		here := queue[0]
		queue = queue[1:]
		objs, err := fs.List(ctx, here.path, &fs.ListArgs{Refresh: refresh})
		if err != nil {
			if here.depth == 0 {
				return nil, err
			}
			continue
		}
		for _, obj := range objs {
			if !obj.IsDir() || here.depth+1 > renameTreeDepth || tgvio.Skip(obj.GetName()) {
				continue
			}
			queue = append(queue, level{stdpath.Join(here.path, obj.GetName()), here.depth + 1})
		}
		if here.depth == 0 {
			continue
		}
		// Folders with videos or subtitles, ads to clear, or one folder wrapped
		// in them ("潜伏3 (2015)/[DBD-Raws][潜伏3]…/").
		worth, kept, keptDir := false, 0, false
		for _, obj := range objs {
			entry := tgvio.RenameEntry{Name: obj.GetName(), IsDir: obj.IsDir(), Size: obj.GetSize()}
			if tgvio.IsJunk(entry) || !obj.IsDir() && tgvio.RenameWorthy(obj.GetName()) {
				worth = true
			}
			if !tgvio.IsJunk(entry) {
				kept++
				keptDir = obj.IsDir()
			}
		}
		if worth || kept == 1 && keptDir {
			folders = append(folders, renameTreeFolder{Path: here.path, Depth: here.depth})
		}
	}
	return folders, nil
}

type renameApplyItem struct {
	Old string `json:"old"`
	New string `json:"new"`
	// Into: then move it into this folder here (made when missing).
	Into string `json:"into,omitempty"`
}

type renameApplyReq struct {
	Path     string            `json:"path"`
	Password string            `json:"password"`
	Items    []renameApplyItem `json:"items"`
	Folder   string            `json:"folder"` // the folder's new name, empty to keep it
	// Subject: what the plan named the folder after, so its new name gets that poster.
	Subject *tgvio.RenameInherit `json:"subject"`
	// Remove: ads and leftovers the plan found (each must still look like one).
	Remove []string `json:"remove"`
	// Unwrap: a folder here wrapped around the film; its contents move up here and it goes.
	Unwrap []string `json:"unwrap"`
	// Batch: the 整理 run these changes belong to, to put it back later (rename/undo).
	Batch string `json:"batch"`
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
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	if len(req.Remove) > 0 && !user.CanRemove() || len(req.Unwrap) > 0 && (!user.CanMove() || !user.CanRemove()) {
		common.ErrorResp(c, errs.PermissionDenied, 403)
		return
	}
	results := make([]renameResult, 0, len(req.Items)+len(req.Remove)+len(req.Unwrap)+1)
	for _, name := range req.Remove {
		result := renameResult{Old: name}
		if err := removeJunk(ctx, reqPath, name); err != nil {
			result.Error = err.Error()
		} else {
			record(req.Batch, user.ID, nil, 1)
		}
		results = append(results, result)
		time.Sleep(250 * time.Millisecond)
	}
	for _, name := range req.Unwrap {
		result := renameResult{Old: name}
		moved, err := unwrapFolder(ctx, reqPath, name)
		if err != nil {
			result.Error = err.Error()
		}
		if len(moved) > 0 {
			record(req.Batch, user.ID, &journalOp{Op: "unwrap", Dir: reqPath, Old: name, Moved: moved}, 0)
		}
		results = append(results, result)
	}
	for i, item := range req.Items {
		if i > 0 {
			time.Sleep(250 * time.Millisecond)
		}
		result := renameResult{Old: item.Old, New: item.New}
		if item.Into != "" && !user.CanMove() {
			result.Error = errs.PermissionDenied.Error()
		} else if err := placeFile(ctx, reqPath, item.Old, item.New, item.Into); err != nil {
			result.Error = err.Error()
		} else {
			record(req.Batch, user.ID, placedOp(reqPath, item.Old, item.New, item.Into), 0)
		}
		results = append(results, result)
	}
	finalPath := reqPath
	if folder := strings.TrimSpace(req.Folder); folder != "" && folder != stdpath.Base(reqPath) {
		result := renameResult{Old: stdpath.Base(reqPath), New: folder}
		if moved, err := renameFolderTo(ctx, reqPath, folder, req.Subject); err != nil {
			result.Error = err.Error()
		} else {
			finalPath = moved
			record(req.Batch, user.ID, &journalOp{Op: "folder", Dir: stdpath.Dir(reqPath), Old: stdpath.Base(reqPath), New: folder}, 0)
		}
		results = append(results, result)
	}
	shown, _ := user.ShowPath(finalPath)
	common.SuccessResp(c, gin.H{"results": results, "path": shown})
}

// removeJunk deletes an ad or leftover file in dir, checked again here: only
// what the planner calls junk (a small text file or link, a leftover) goes.
func removeJunk(ctx context.Context, dir, name string) error {
	if err := checkRelativePath(name); err != nil || strings.Contains(name, "/") {
		return fmt.Errorf("not a name here")
	}
	obj, err := fs.Get(ctx, stdpath.Join(dir, name), &fs.GetArgs{NoLog: true})
	if err != nil {
		return err
	}
	if !tgvio.IsJunk(tgvio.RenameEntry{Name: obj.GetName(), IsDir: obj.IsDir(), Size: obj.GetSize()}) {
		return fmt.Errorf("[%s] is no ad or leftover", name)
	}
	return fs.Remove(ctx, stdpath.Join(dir, name))
}

// unwrapFolder moves what is in dir/name up into dir, then removes the folder
// once it is empty. Nothing moves when a name is taken in dir already.
// moved: what came up, also when it stopped half way.
func unwrapFolder(ctx context.Context, dir, name string) (moved []string, err error) {
	if err := checkRelativePath(name); err != nil || strings.Contains(name, "/") {
		return nil, fmt.Errorf("not a name here")
	}
	inner := stdpath.Join(dir, name)
	objs, err := fs.List(ctx, inner, &fs.ListArgs{Refresh: true})
	if err != nil {
		return nil, err
	}
	for _, obj := range objs {
		if obj.GetName() == name {
			return nil, fmt.Errorf("[%s] holds a folder of its own name", name)
		}
		if res, _ := fs.Get(ctx, stdpath.Join(dir, obj.GetName()), &fs.GetArgs{NoLog: true}); res != nil {
			return nil, fmt.Errorf("file [%s] exists", obj.GetName())
		}
	}
	for i, obj := range objs {
		if i > 0 {
			time.Sleep(time.Second) // 115 moves folders in the background, one after another
		}
		if err := moveRetrying(ctx, stdpath.Join(inner, obj.GetName()), dir); err != nil {
			return moved, err
		}
		posters().Moved(inner, dir, obj.GetName())
		moved = append(moved, obj.GetName())
	}
	left, err := fs.List(ctx, inner, &fs.ListArgs{Refresh: true})
	if err != nil {
		return moved, err
	}
	if len(left) > 0 {
		return moved, fmt.Errorf("[%s] is not empty after moving", name)
	}
	return moved, fs.Remove(ctx, inner)
}

// renameIn renames dir/oldName to newName (never over another object) and
// moves its poster record along.
func renameIn(ctx context.Context, dir, oldName, newName string) error {
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
	if err := fs.Rename(ctx, stdpath.Join(dir, oldName), newName); err != nil {
		return err
	}
	posters().Renamed(dir, oldName, newName, dir)
	return nil
}

// renameFolderTo renames the folder at path and returns its new path; subject
// (what it was planned as) gives the new name its poster at once.
func renameFolderTo(ctx context.Context, path, name string, subject *tgvio.RenameInherit) (string, error) {
	parent, old := stdpath.Dir(path), stdpath.Base(path)
	if err := checkRelativePath(name); err != nil {
		return "", err
	}
	if strings.TrimSpace(name) == "" || name == old {
		return "", fmt.Errorf("nothing to rename")
	}
	if !strings.EqualFold(old, name) {
		if res, _ := fs.Get(ctx, stdpath.Join(parent, name), &fs.GetArgs{NoLog: true}); res != nil {
			return "", fmt.Errorf("file [%s] exists", name)
		}
	}
	if err := fs.Rename(ctx, path, name); err != nil {
		return "", err
	}
	store := posters()
	moved := stdpath.Join(parent, name)
	if subject != nil && subject.ID > 0 && (subject.Kind == "tv" || subject.Kind == "movie") {
		store.RenamedAs(ctx, parent, old, name, parent, *subject)
	} else {
		store.Renamed(parent, old, name, parent)
	}
	store.RenamedDir(path, moved)
	return moved, nil
}

// placeFile renames dir/oldName to newName and, with into, moves it into the
// folder dir/into (made when missing), never over another object.
func placeFile(ctx context.Context, dir, oldName, newName, into string) error {
	if into == "" {
		return renameIn(ctx, dir, oldName, newName)
	}
	for _, name := range []string{oldName, newName, into} {
		if err := checkRelativePath(name); err != nil || strings.Contains(name, "/") || strings.TrimSpace(name) == "" {
			return fmt.Errorf("not a name here")
		}
	}
	folder := stdpath.Join(dir, into)
	if obj, _ := fs.Get(ctx, folder, &fs.GetArgs{NoLog: true}); obj == nil {
		if err := fs.MakeDir(ctx, folder); err != nil {
			return err
		}
	} else if !obj.IsDir() {
		return fmt.Errorf("file [%s] exists", into)
	}
	if res, _ := fs.Get(ctx, stdpath.Join(folder, newName), &fs.GetArgs{NoLog: true}); res != nil {
		return fmt.Errorf("file [%s/%s] exists", into, newName)
	}
	if oldName != newName {
		if err := renameIn(ctx, dir, oldName, newName); err != nil {
			return err
		}
	}
	if err := moveRetrying(ctx, stdpath.Join(dir, newName), folder); err != nil {
		return err
	}
	posters().Moved(dir, folder, newName)
	posters().NameFolderAs(dir, into, newName)
	return nil
}

// moveRetrying moves src into dst; while 115 is still busy with an earlier move
// ("移动[…]操作尚未执行完成，请稍后再试", errno 990009) it waits and tries again.
func moveRetrying(ctx context.Context, src, dst string) error {
	for wait := 3 * time.Second; ; wait *= 2 {
		_, err := fs.Move(ctx, src, dst)
		if err == nil || wait > 48*time.Second || !(strings.Contains(err.Error(), "990009") || strings.Contains(err.Error(), "尚未执行完成")) {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(wait):
		}
	}
}

// placedOp is what placeFile did, for the journal.
func placedOp(dir, oldName, newName, into string) *journalOp {
	if into == "" {
		return &journalOp{Op: "rename", Dir: dir, Old: oldName, New: newName}
	}
	return &journalOp{Op: "place", Dir: dir, Old: oldName, New: newName, Into: into}
}
