package handles

import (
	"context"
	"encoding/json"
	"os"
	stdpath "path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/OpenListTeam/OpenList/v4/cmd/flags"
	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/fs"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/offline_download/tool"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/internal/tgvio"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/OpenListTeam/tache"
	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
)

// TGVIO: folders 找资源 made are organized by the server once their downloads
// are done — the same plan 整理 shows, applied without asking, but only when
// nothing in it needs a person: every video named, no season to pick, no
// version to confirm. Anything else stays in 整理模式.

var (
	autoOrganizeOnce sync.Once
	autoTried        = map[string]time.Time{} // folder -> last look that found it not ready

	autoMu     sync.Mutex
	autoRecent []autoNote // newest first, what the organizer did (since the server started)
)

// autoNote is one folder the organizer looked at: organized, or left to a person and why.
type autoNote struct {
	Path string    `json:"path"` // real path, afterwards
	At   time.Time `json:"at"`
	Done bool      `json:"done"`
	Why  string    `json:"why,omitempty"` // "person": something needs a person; "error": it failed
	// Batch: the journal's run, to put it back (rename/undo).
	Batch string `json:"batch,omitempty"`
}

func noteAuto(n autoNote) {
	autoMu.Lock()
	defer autoMu.Unlock()
	for i, old := range autoRecent {
		if old.Path == n.Path {
			autoRecent = append(autoRecent[:i], autoRecent[i+1:]...)
			break
		}
	}
	autoRecent = append([]autoNote{n}, autoRecent...)
	if len(autoRecent) > 20 {
		autoRecent = autoRecent[:20]
	}
	if raw, err := json.Marshal(autoRecent); err == nil {
		_ = os.WriteFile(autoRecentFile(), raw, 0o600)
	}
}

func autoRecentFile() string { return filepath.Join(flags.DataDir, "tgvio", "organize-recent.json") }

const (
	autoOrganizeEvery = 3 * time.Minute
	autoOrganizeRetry = 30 * time.Minute
)

// StartTgvioAutoOrganize starts the background organizer (once).
func StartTgvioAutoOrganize() {
	autoOrganizeOnce.Do(func() {
		followPaths()
		if raw, err := os.ReadFile(autoRecentFile()); err == nil {
			_ = json.Unmarshal(raw, &autoRecent)
		}
		go func() {
			time.Sleep(time.Minute)
			for {
				autoOrganizeRound()
				time.Sleep(autoOrganizeEvery)
			}
		}()
	})
}

func autoOrganizeRound() {
	defer func() {
		if r := recover(); r != nil {
			log.Errorf("tgvio auto organize: %v", r)
		}
	}()
	if resourceSites().Config().ManualOrganize || !posters().Enabled() {
		return
	}
	admin, err := op.GetAdmin()
	if err != nil {
		return
	}
	ctx := context.WithValue(context.Background(), conf.UserKey, admin)
	scanLibraryRoots(ctx)
	pending := organizeStore().Pending(2 * time.Minute)
	if len(pending) == 0 {
		return
	}
	busy := downloadingInto()
	sort.Strings(pending)
	for _, dir := range pending {
		if at, ok := autoTried[dir]; ok && time.Since(at) < autoOrganizeRetry {
			continue
		}
		if busyUnder(busy, dir) || !posters().InLibrary(dir) {
			continue
		}
		done, final, err := autoOrganize(ctx, dir)
		if err != nil {
			log.Warnf("tgvio auto organize %s: %v", dir, err)
			noteAuto(autoNote{Path: final, At: time.Now(), Why: "error"})
		}
		if !done {
			if err == nil && final == "" {
				noteAuto(autoNote{Path: dir, At: time.Now(), Why: "person"})
			}
			autoTried[dir] = time.Now()
			continue
		}
		noteAuto(autoNote{Path: final, At: time.Now(), Done: true, Batch: lastAutoBatch})
		delete(autoTried, dir)
		_ = organizeStore().Mark(dir, false)
		if final != dir {
			_ = organizeStore().Mark(final, false)
		}
		log.Infof("tgvio auto organize: %s -> %s", dir, final)
	}
}

var lastRootScan time.Time

// scanLibraryRoots: folders put straight into a library folder (by hand, by
// upload, by another tool) wait to be organized like downloads 找资源 made,
// once they have been there a while. Each library folder is read afresh
// every ten minutes; what was there before the first look is left alone.
func scanLibraryRoots(ctx context.Context) {
	if time.Since(lastRootScan) < 10*time.Minute {
		return
	}
	lastRootScan = time.Now()
	for _, root := range posters().Config().Paths {
		if root == "/" || !posters().InLibrary(root) {
			continue // the whole drive: no folder of its own to watch
		}
		objs, err := fs.List(ctx, root, &fs.ListArgs{Refresh: true})
		if err != nil {
			continue
		}
		var names []string
		for _, obj := range objs {
			if obj.IsDir() && !tgvio.Skip(obj.GetName()) {
				names = append(names, obj.GetName())
			}
		}
		for _, p := range organizeStore().NewFolders(root, names) {
			if !busyUnder(downloadingInto(), p) {
				_ = organizeStore().Mark(p, true)
				log.Infof("tgvio auto organize: new folder %s", p)
			}
		}
	}
}

// downloadingInto lists the folders offline downloads are still working on.
func downloadingInto() []string {
	finished := func(s tache.State) bool {
		return s == tache.StateSucceeded || s == tache.StateCanceled || s == tache.StateFailed
	}
	var out []string
	if tool.DownloadTaskManager != nil {
		for _, t := range tool.DownloadTaskManager.GetAll() {
			if !finished(t.GetState()) {
				out = append(out, t.DstDirPath)
			}
		}
	}
	if tool.TransferTaskManager != nil {
		for _, t := range tool.TransferTaskManager.GetAll() {
			if !finished(t.GetState()) {
				out = append(out, stdpath.Join(t.DstStorageMp, t.DstActualPath))
			}
		}
	}
	return out
}

func busyUnder(busy []string, dir string) bool {
	for _, p := range busy {
		p = stdpath.Clean("/" + p)
		if p == dir || strings.HasPrefix(p, dir+"/") || strings.HasPrefix(dir, p+"/") {
			return true
		}
	}
	return false
}

type autoFolder struct {
	path  string
	depth int
	plan  *tgvio.RenamePlan
}

// autoOrganize plans the folder and everything below it and applies the plan
// when nothing needs a person. done is false (and nothing is changed) when the
// download has not landed yet, or a person has to look (final is "" then);
// final is the folder's path afterwards.
var lastAutoBatch string // the journal run autoOrganize used last (one round at a time)

func autoOrganize(ctx context.Context, root string) (done bool, final string, err error) {
	tree, err := renameTreeOf(ctx, root, true)
	if err != nil {
		return false, root, err
	}
	store := posters()
	folders := make([]*autoFolder, 0, len(tree))
	videos := 0
	for _, f := range tree {
		objs, err := fs.List(ctx, f.Path, &fs.ListArgs{})
		if err != nil {
			return false, root, err
		}
		entries := make([]tgvio.RenameEntry, 0, len(objs))
		for _, obj := range objs {
			entries = append(entries, tgvio.RenameEntry{Name: obj.GetName(), IsDir: obj.IsDir(), Size: obj.GetSize()})
		}
		// Named after the nearest folder above that found something (as 整理 does).
		var inherit *tgvio.RenameInherit
		nearest := ""
		for _, above := range folders {
			if strings.HasPrefix(f.Path, above.path+"/") && above.plan.Subject != nil && len(above.path) > len(nearest) {
				nearest = above.path
				inherit = &tgvio.RenameInherit{Kind: above.plan.Subject.Kind, ID: above.plan.Subject.ID, Season: above.plan.Season, Film: above.plan.Film}
			}
		}
		plan, err := store.PlanRenameIn(ctx, f.Path, entries, 0, inherit)
		if err != nil {
			return false, root, err
		}
		if plan.Reason != "" || plan.Need != "" {
			return false, "", nil // a person decides
		}
		for _, item := range plan.Items {
			if item.Kind != "video" {
				continue
			}
			videos++
			// A video without a name (no episode number, a conflict) or a version to confirm: a person decides.
			if item.New == "" && item.Reason != "same" || item.Reason == "version" {
				return false, "", nil
			}
		}
		folders = append(folders, &autoFolder{path: f.Path, depth: f.Depth, plan: plan})
	}
	if videos == 0 {
		return false, root, nil // not landed yet
	}
	unwrapped := map[string]bool{}
	for _, f := range folders {
		for _, item := range f.plan.Items {
			if item.Action == "unwrap" {
				unwrapped[stdpath.Join(f.path, item.Old)] = true
			}
		}
	}
	// Deepest first: renaming a folder moves everything below it.
	sort.SliceStable(folders, func(i, j int) bool { return folders[i].depth > folders[j].depth })
	final = root
	pause := func() { time.Sleep(250 * time.Millisecond) }
	batch := "auto-" + strconv.FormatInt(time.Now().UnixNano(), 36)
	lastAutoBatch = batch
	var admin uint
	if u, ok := ctx.Value(conf.UserKey).(*model.User); ok {
		admin = u.ID
	}
	for _, f := range folders {
		rank := func(item tgvio.RenameItem) int {
			switch item.Action {
			case "unwrap":
				return 2
			case "delete":
				return 1
			}
			return 0
		}
		items := append([]tgvio.RenameItem(nil), f.plan.Items...)
		sort.SliceStable(items, func(i, j int) bool { return rank(items[i]) < rank(items[j]) })
		for _, item := range items {
			switch {
			case item.Action == "delete":
				if err = removeJunk(ctx, f.path, item.Old); err == nil {
					record(batch, admin, nil, 1)
				}
			case item.Action == "unwrap":
				var moved []string
				moved, err = unwrapFolder(ctx, f.path, item.Old)
				if len(moved) > 0 {
					record(batch, admin, &journalOp{Op: "unwrap", Dir: f.path, Old: item.Old, Moved: moved}, 0)
				}
			case item.Action == "spill" || item.Reason == "version":
				continue // a person decides
			case item.Kind != "folder" && item.New != "":
				if err = placeFile(ctx, f.path, item.Old, item.New, item.Into); err == nil {
					record(batch, admin, placedOp(f.path, item.Old, item.New, item.Into), 0)
				}
			default:
				continue
			}
			if err != nil {
				return false, final, err
			}
			pause()
		}
		if unwrapped[f.path] {
			continue // opened up by the folder above: its name goes with it
		}
		for _, item := range f.plan.Items {
			if item.Kind != "folder" || item.New == "" {
				continue
			}
			var subject *tgvio.RenameInherit
			if f.plan.SeriesFirst > 0 {
				subject = &tgvio.RenameInherit{Kind: "movie", ID: f.plan.SeriesFirst}
			} else if s := f.plan.Subject; s != nil {
				subject = &tgvio.RenameInherit{Kind: s.Kind, ID: s.ID, Season: f.plan.Season}
			}
			moved, err := renameFolderTo(ctx, f.path, item.New, subject)
			if err != nil {
				return false, final, err
			}
			record(batch, admin, &journalOp{Op: "folder", Dir: stdpath.Dir(f.path), Old: stdpath.Base(f.path), New: item.New}, 0)
			if f.depth == 0 {
				final = moved
			}
			pause()
		}
	}
	return true, final, nil
}

// TgvioOrganizeRecent: GET /api/tgvio/organize/recent — what the organizer did lately, in the folders this user sees.
func TgvioOrganizeRecent(c *gin.Context) {
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	autoMu.Lock()
	notes := append([]autoNote(nil), autoRecent...)
	autoMu.Unlock()
	out := []autoNote{}
	for _, n := range notes {
		if shown, ok := user.ShowPath(n.Path); ok {
			n.Path = shown
			out = append(out, n)
		}
	}
	common.SuccessResp(c, gin.H{"items": out})
}
