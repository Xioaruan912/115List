package handles

import (
	"context"
	stdpath "path"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/fs"
	"github.com/OpenListTeam/OpenList/v4/internal/offline_download/tool"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/internal/tgvio"
	"github.com/OpenListTeam/tache"
	log "github.com/sirupsen/logrus"
)

// TGVIO: folders 找资源 made are organized by the server once their downloads
// are done — the same plan 整理 shows, applied without asking, but only when
// nothing in it needs a person: every video named, no season to pick, no
// version to confirm. Anything else stays in 整理模式.

var (
	autoOrganizeOnce sync.Once
	autoTried        = map[string]time.Time{} // folder -> last look that found it not ready
)

const (
	autoOrganizeEvery = 3 * time.Minute
	autoOrganizeRetry = 30 * time.Minute
)

// StartTgvioAutoOrganize starts the background organizer (once).
func StartTgvioAutoOrganize() {
	autoOrganizeOnce.Do(func() {
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
	pending := organizeStore().Pending(2 * time.Minute)
	if len(pending) == 0 {
		return
	}
	admin, err := op.GetAdmin()
	if err != nil {
		return
	}
	ctx := context.WithValue(context.Background(), conf.UserKey, admin)
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
		}
		if !done {
			autoTried[dir] = time.Now()
			continue
		}
		delete(autoTried, dir)
		_ = organizeStore().Mark(dir, false)
		if final != dir {
			_ = organizeStore().Mark(final, false)
		}
		log.Infof("tgvio auto organize: %s -> %s", dir, final)
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
// download has not landed yet or a person has to look; final is the folder's
// path afterwards.
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
				inherit = &tgvio.RenameInherit{Kind: above.plan.Subject.Kind, ID: above.plan.Subject.ID, Season: above.plan.Season}
			}
		}
		plan, err := store.PlanRenameIn(ctx, f.Path, entries, 0, inherit)
		if err != nil {
			return false, root, err
		}
		if plan.Reason != "" || plan.Need != "" {
			return false, root, nil
		}
		for _, item := range plan.Items {
			if item.Kind != "video" {
				continue
			}
			videos++
			// A video without a name (no episode number, a conflict) or a version to confirm: a person decides.
			if item.New == "" && item.Reason != "same" || item.Reason == "version" {
				return false, root, nil
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
				err = removeJunk(ctx, f.path, item.Old)
			case item.Action == "unwrap":
				err = unwrapFolder(ctx, f.path, item.Old)
			case item.Kind != "folder" && item.New != "":
				err = renameIn(ctx, f.path, item.Old, item.New)
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
			if s := f.plan.Subject; s != nil {
				subject = &tgvio.RenameInherit{Kind: s.Kind, ID: s.ID, Season: f.plan.Season}
			}
			moved, err := renameFolderTo(ctx, f.path, item.New, subject)
			if err != nil {
				return false, final, err
			}
			if f.depth == 0 {
				final = moved
			}
			pause()
		}
	}
	return true, final, nil
}
