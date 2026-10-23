package handles

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	stdpath "path"
	"path/filepath"
	"sync"
	"time"

	"github.com/OpenListTeam/OpenList/v4/cmd/flags"
	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/errs"
	"github.com/OpenListTeam/OpenList/v4/internal/fs"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
)

// TGVIO: what 整理 changed, run by run, so a run can be put back
// (data/tgvio/rename-journal.json, the last 30 runs). Deleted ads cannot
// come back; they are only counted.

type journalOp struct {
	Op    string   `json:"op"` // "rename", "place", "unwrap", "folder"
	Dir   string   `json:"dir"`
	Old   string   `json:"old"`
	New   string   `json:"new,omitempty"`
	Into  string   `json:"into,omitempty"`
	Moved []string `json:"moved,omitempty"` // unwrap: what came up out of Old
}

type journalBatch struct {
	ID      string      `json:"id"`
	User    uint        `json:"user"`
	At      time.Time   `json:"at"`
	Root    string      `json:"root"` // real path of the first folder touched
	Ops     []journalOp `json:"ops"`
	Deleted int         `json:"deleted,omitempty"`
	Undone  bool        `json:"undone,omitempty"`
}

var (
	journalMu     sync.Mutex
	journalLoaded bool
	journal       []*journalBatch // oldest first
)

const journalKeep = 30

func journalFile() string { return filepath.Join(flags.DataDir, "tgvio", "rename-journal.json") }

func journalLoadLocked() {
	if journalLoaded {
		return
	}
	journalLoaded = true
	if raw, err := os.ReadFile(journalFile()); err == nil {
		_ = json.Unmarshal(raw, &journal)
	}
}

func journalSaveLocked() {
	if len(journal) > journalKeep {
		journal = journal[len(journal)-journalKeep:]
	}
	if raw, err := json.Marshal(journal); err == nil {
		_ = os.MkdirAll(filepath.Dir(journalFile()), 0o700)
		_ = os.WriteFile(journalFile(), raw, 0o600)
	}
}

// record adds what was done to run id (made on first use); deleted counts ads removed.
func record(id string, user uint, op *journalOp, deleted int) {
	if id == "" {
		return
	}
	journalMu.Lock()
	defer journalMu.Unlock()
	journalLoadLocked()
	var b *journalBatch
	for _, cur := range journal {
		if cur.ID == id {
			b = cur
		}
	}
	if b == nil {
		b = &journalBatch{ID: id, User: user, At: time.Now()}
		journal = append(journal, b)
	}
	if op != nil {
		if b.Root == "" {
			b.Root = op.Dir
		}
		b.Ops = append(b.Ops, *op)
	}
	b.Deleted += deleted
	journalSaveLocked()
}

// TgvioRenameJournal: GET /api/tgvio/rename/journal — this user's recent 整理 runs, newest first.
func TgvioRenameJournal(c *gin.Context) {
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	journalMu.Lock()
	journalLoadLocked()
	type out struct {
		ID      string    `json:"id"`
		At      time.Time `json:"at"`
		Root    string    `json:"root"`
		Changes int       `json:"changes"`
		Deleted int       `json:"deleted"`
		Undone  bool      `json:"undone"`
	}
	list := []out{}
	for i := len(journal) - 1; i >= 0; i-- {
		b := journal[i]
		if b.User != user.ID && !user.IsAdmin() || len(b.Ops) == 0 {
			continue
		}
		root, ok := user.ShowPath(b.Root)
		if !ok {
			continue
		}
		list = append(list, out{b.ID, b.At, root, len(b.Ops), b.Deleted, b.Undone})
	}
	journalMu.Unlock()
	common.SuccessResp(c, gin.H{"items": list})
}

type undoReq struct {
	ID string `json:"id"`
}

// TgvioRenameUndo: POST /api/tgvio/rename/undo {id} — puts one 整理 run back, last change first.
func TgvioRenameUndo(c *gin.Context) {
	var req undoReq
	if err := c.ShouldBindJSON(&req); err != nil || req.ID == "" {
		common.ErrorStrResp(c, "give the run's id", 400)
		return
	}
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	if !user.CanRename() || !user.CanMove() {
		common.ErrorResp(c, errs.PermissionDenied, 403)
		return
	}
	journalMu.Lock()
	journalLoadLocked()
	var b *journalBatch
	for _, cur := range journal {
		if cur.ID == req.ID {
			b = cur
		}
	}
	if b == nil || b.User != user.ID && !user.IsAdmin() {
		journalMu.Unlock()
		common.ErrorStrResp(c, "no such run", 404)
		return
	}
	if b.Undone {
		journalMu.Unlock()
		common.ErrorStrResp(c, "this run was put back already", 400)
		return
	}
	ops := append([]journalOp(nil), b.Ops...)
	journalMu.Unlock()
	for _, op := range ops {
		if !user.Sees(op.Dir) {
			common.ErrorResp(c, errs.PermissionDenied, 403)
			return
		}
	}
	ctx := c.Request.Context()
	for i := len(ops) - 1; i >= 0; i-- {
		if err := undoOp(ctx, ops[i]); err != nil {
			// What was put back so far stays put back; the rest of the run can be tried again.
			journalMu.Lock()
			b.Ops = ops[:i+1]
			journalSaveLocked()
			journalMu.Unlock()
			common.ErrorStrResp(c, fmt.Sprintf("%s: %v", stdpath.Join(ops[i].Dir, ops[i].Old), err), 500)
			return
		}
		time.Sleep(250 * time.Millisecond)
	}
	journalMu.Lock()
	b.Undone = true
	journalSaveLocked()
	journalMu.Unlock()
	common.SuccessResp(c, gin.H{"changes": len(ops)})
}

func undoOp(ctx context.Context, op journalOp) error {
	switch op.Op {
	case "rename":
		return renameIn(ctx, op.Dir, op.New, op.Old)
	case "place":
		folder := stdpath.Join(op.Dir, op.Into)
		if res, _ := fs.Get(ctx, stdpath.Join(op.Dir, op.New), &fs.GetArgs{NoLog: true}); res != nil {
			return fmt.Errorf("file [%s] exists", op.New)
		}
		if err := moveRetrying(ctx, stdpath.Join(folder, op.New), op.Dir); err != nil {
			return err
		}
		posters().Moved(folder, op.Dir, op.New)
		if op.Old != op.New {
			if err := renameIn(ctx, op.Dir, op.New, op.Old); err != nil {
				return err
			}
		}
		if left, err := fs.List(ctx, folder, &fs.ListArgs{Refresh: true}); err == nil && len(left) == 0 {
			_ = fs.Remove(ctx, folder)
		}
		return nil
	case "unwrap":
		wrapper := stdpath.Join(op.Dir, op.Old)
		if obj, _ := fs.Get(ctx, wrapper, &fs.GetArgs{NoLog: true}); obj == nil {
			if err := fs.MakeDir(ctx, wrapper); err != nil {
				return err
			}
		}
		for i, name := range op.Moved {
			if i > 0 {
				time.Sleep(time.Second)
			}
			if err := moveRetrying(ctx, stdpath.Join(op.Dir, name), wrapper); err != nil {
				return err
			}
			posters().Moved(op.Dir, wrapper, name)
		}
		return nil
	case "folder":
		_, err := renameFolderTo(ctx, stdpath.Join(op.Dir, op.New), op.Old, nil)
		return err
	}
	return fmt.Errorf("unknown change %q", op.Op)
}
