package handles

import (
	"context"
	"encoding/json"
	"os"
	stdpath "path"
	"path/filepath"
	"sync"
	"time"

	"github.com/OpenListTeam/OpenList/v4/cmd/flags"
	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/fs"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/internal/tgvio"
	log "github.com/sirupsen/logrus"
)

// TGVIO: a library folder's ads go when anyone opens it, not only when a
// download is organized: the listing just read is judged (tgvio.JunkToSweep,
// no extra drive request), and what it picks is removed in the background,
// one a second, each checked again first. Removed files go to the drive's
// recycle bin; each is noted (data/tgvio/junk-removed.json, the last 200).

type sweptFile struct {
	Path string    `json:"path"` // real path
	Size int64     `json:"size"`
	At   time.Time `json:"at"`
}

type sweepJob struct {
	dir   string
	names []string
	whole bool
}

var (
	sweepOnce   sync.Once
	sweepQueue  = make(chan sweepJob, 256)
	sweepMu     sync.Mutex
	sweepQueued = map[string]bool{} // dir -> waiting in the queue
	swept       []sweptFile         // newest first
	sweptLoaded bool
)

func sweptFileName() string { return filepath.Join(flags.DataDir, "tgvio", "junk-removed.json") }

// sweepLibraryJunk looks at a library folder's listing and queues its ads.
func sweepLibraryJunk(dir string, objs []model.Obj) {
	if resourceSites().Config().ManualOrganize || !posters().Enabled() || !posters().InLibrary(dir) || isLibraryRoot(dir) {
		return
	}
	entries := make([]tgvio.RenameEntry, 0, len(objs))
	for _, obj := range objs {
		entries = append(entries, tgvio.RenameEntry{Name: obj.GetName(), IsDir: obj.IsDir(), Size: obj.GetSize()})
	}
	names, whole := tgvio.JunkToSweep(entries)
	if len(names) == 0 {
		return
	}
	sweepMu.Lock()
	if sweepQueued[dir] {
		sweepMu.Unlock()
		return
	}
	sweepQueued[dir] = true
	sweepMu.Unlock()
	sweepOnce.Do(func() { go sweepWorker() })
	select {
	case sweepQueue <- sweepJob{dir: dir, names: names, whole: whole}:
	default:
		sweepMu.Lock()
		delete(sweepQueued, dir)
		sweepMu.Unlock()
	}
}

func isLibraryRoot(dir string) bool {
	for _, root := range posters().Config().Paths {
		if dir == root {
			return true
		}
	}
	return false
}

func sweepWorker() {
	for job := range sweepQueue {
		sweepFolder(job)
		sweepMu.Lock()
		delete(sweepQueued, job.dir)
		sweepMu.Unlock()
	}
}

func sweepFolder(job sweepJob) {
	defer func() {
		if r := recover(); r != nil {
			log.Errorf("tgvio junk sweep: %v", r)
		}
	}()
	// A download still landing, or waiting for the organizer: the organizer deals with it.
	if busyUnder(downloadingInto(), job.dir) {
		return
	}
	for _, p := range organizeStore().Pending(0) {
		if p == job.dir || len(job.dir) > len(p) && job.dir[:len(p)+1] == p+"/" {
			return
		}
	}
	admin, err := op.GetAdmin()
	if err != nil {
		return
	}
	ctx := context.WithValue(context.Background(), conf.UserKey, admin)
	// Judged again from a fresh listing: what was shown may be old.
	objs, err := fs.List(ctx, job.dir, &fs.ListArgs{})
	if err != nil {
		return
	}
	entries := make([]tgvio.RenameEntry, 0, len(objs))
	sizes := map[string]int64{}
	for _, obj := range objs {
		entries = append(entries, tgvio.RenameEntry{Name: obj.GetName(), IsDir: obj.IsDir(), Size: obj.GetSize()})
		sizes[obj.GetName()] = obj.GetSize()
	}
	names, whole := tgvio.JunkToSweep(entries)
	var removed []sweptFile
	for _, name := range names {
		time.Sleep(time.Second)
		p := stdpath.Join(job.dir, name)
		if err := fs.Remove(ctx, p); err != nil {
			log.Warnf("tgvio junk sweep %s: %v", p, err)
			return
		}
		removed = append(removed, sweptFile{Path: p, Size: sizes[name], At: time.Now()})
		log.Infof("tgvio junk sweep: removed %s (%d bytes)", p, sizes[name])
	}
	if whole {
		// Nothing but ads was in it: the folder goes too, once it is empty.
		if left, err := fs.List(ctx, job.dir, &fs.ListArgs{Refresh: true}); err == nil && len(left) == 0 {
			time.Sleep(time.Second)
			if err := fs.Remove(ctx, job.dir); err == nil {
				log.Infof("tgvio junk sweep: removed empty folder %s", job.dir)
			}
		}
	}
	noteSwept(removed)
}

func noteSwept(files []sweptFile) {
	if len(files) == 0 {
		return
	}
	sweepMu.Lock()
	defer sweepMu.Unlock()
	loadSweptLocked()
	for _, f := range files {
		swept = append([]sweptFile{f}, swept...)
	}
	if len(swept) > 200 {
		swept = swept[:200]
	}
	if raw, err := json.Marshal(swept); err == nil {
		_ = os.WriteFile(sweptFileName(), raw, 0o600)
	}
}

func loadSweptLocked() {
	if sweptLoaded {
		return
	}
	sweptLoaded = true
	if raw, err := os.ReadFile(sweptFileName()); err == nil {
		_ = json.Unmarshal(raw, &swept)
	}
}

// recentSwept: what was removed lately, newest first (for the transfers panel).
func recentSwept(limit int) []sweptFile {
	sweepMu.Lock()
	defer sweepMu.Unlock()
	loadSweptLocked()
	if len(swept) < limit {
		limit = len(swept)
	}
	return append([]sweptFile(nil), swept[:limit]...)
}
