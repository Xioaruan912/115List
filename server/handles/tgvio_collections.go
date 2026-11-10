package handles

import (
	"context"
	stdpath "path"
	"sort"
	"strings"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/fs"
	"github.com/OpenListTeam/OpenList/v4/internal/tgvio"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
)

// TGVIO: a film that belongs to a TMDB series joins the others of it. Films
// are downloads put straight into a library folder ("哥斯拉 (2014)" beside
// "哥斯拉2：怪兽之王 (2019)"); the library shows them as one series, like the
// collection folders it already has (钢铁侠, 指环王).

type collectionGroup struct {
	Collection int      `json:"collection"`
	Name       string   `json:"name"`
	Target     string   `json:"target"`
	Members    []string `json:"members"`
	Moved      bool     `json:"moved,omitempty"`
	Error      string   `json:"error,omitempty"`
}

// folderHoldsFilm: the folder has a video of its own, so it is a film's folder
// (not a series' folder of folders).
func folderHoldsFilm(ctx context.Context, dir string) bool {
	objs, err := fs.List(ctx, dir, &fs.ListArgs{})
	if err != nil {
		return false
	}
	for _, obj := range objs {
		if !obj.IsDir() && tgvio.IsMediaFile(obj.GetName()) {
			return true
		}
	}
	return false
}

// groupCollectionsIn finds the films at a library root that share a TMDB
// collection, two or more, and (with apply) puts them into one folder named
// for the series, as 整理 names a folder of films.
func groupCollectionsIn(ctx context.Context, root string, apply bool) ([]collectionGroup, error) {
	if root == "/" || !posters().InLibrary(root) {
		return nil, nil
	}
	objs, err := fs.List(ctx, root, &fs.ListArgs{Refresh: true})
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(objs))
	for _, obj := range objs {
		if obj.IsDir() {
			names = append(names, obj.GetName())
		}
	}
	if len(names) < 2 {
		return nil, nil
	}
	found, _ := posters().Lookup(root, names)
	type film struct{ name, title string }
	groups := map[int][]film{}
	collName := map[int]string{}
	for _, name := range names {
		p := found[name]
		if p == nil || p.None || p.Kind != "movie" {
			continue
		}
		id, cname := posters().FilmCollection(ctx, p.ID)
		if id == 0 {
			continue
		}
		groups[id] = append(groups[id], film{name, p.Title})
		collName[id] = cname
	}
	out := []collectionGroup{}
	for id, films := range groups {
		if len(films) < 2 {
			continue
		}
		single := make([]film, 0, len(films))
		for _, f := range films {
			if folderHoldsFilm(ctx, stdpath.Join(root, f.name)) {
				single = append(single, f)
			}
		}
		if len(single) < 2 {
			continue
		}
		members := make([]string, 0, len(single))
		titles := make([]string, 0, len(single))
		for _, f := range single {
			members = append(members, f.name)
			titles = append(titles, f.title)
		}
		sort.Strings(members)
		sort.Strings(titles)
		g := collectionGroup{Collection: id, Name: collName[id], Target: tgvio.CollectionFolderName(id, collName[id], titles), Members: members}
		if g.Target == "" {
			continue
		}
		target := ""
		for _, m := range members {
			if m == g.Target {
				target = m // the series' folder is already one of them
			}
		}
		targetPath := stdpath.Join(root, g.Target)
		if target != "" {
			continue // nothing to make or move
		}
		if obj, _ := fs.Get(ctx, targetPath, &fs.GetArgs{NoLog: true}); obj != nil && !obj.IsDir() {
			g.Error = "there is a file by that name"
			out = append(out, g)
			continue
		}
		if !apply {
			out = append(out, g)
			continue
		}
		paths := []string{targetPath}
		for _, m := range members {
			paths = append(paths, stdpath.Join(root, m))
		}
		release, ok := acquireOrganize(paths, "", false)
		if !ok {
			g.Error = "这个文件夹正在整理，等它做完再试"
			out = append(out, g)
			continue
		}
		err := func() error {
			defer release()
			if obj, _ := fs.Get(ctx, targetPath, &fs.GetArgs{NoLog: true}); obj == nil {
				if err := fs.MakeDir(ctx, targetPath); err != nil {
					return err
				}
			}
			for _, m := range members {
				if err := moveRetrying(ctx, stdpath.Join(root, m), targetPath); err != nil {
					return err
				}
				posters().Moved(root, targetPath, m)
			}
			return nil
		}()
		if err != nil {
			g.Error = err.Error()
		} else {
			g.Moved = true
		}
		out = append(out, g)
	}
	sort.Slice(out, func(i, j int) bool { return len(out[i].Members) > len(out[j].Members) })
	return out, nil
}

// TgvioCollectionsGroup: POST /api/admin/tgvio/collections/group {apply}
// (apply false shows what would go where).
func TgvioCollectionsGroup(c *gin.Context) {
	var req struct {
		Apply bool `json:"apply"`
	}
	_ = c.ShouldBindJSON(&req)
	groups := []collectionGroup{}
	for _, root := range posters().Config().Paths {
		found, err := groupCollectionsIn(c.Request.Context(), root, req.Apply)
		if err != nil {
			common.ErrorResp(c, err, 500)
			return
		}
		groups = append(groups, found...)
	}
	common.SuccessResp(c, gin.H{"apply": req.Apply, "groups": groups})
}

// lastCollectionScan: first look half an hour after a restart (a person may
// want to see what the sweep would do first), then every half hour.
var lastCollectionScan = time.Now()

// autoGroupCollections: a film that lands beside others of its series joins
// them by itself. Only when the organizer is idle, so no folder moves under a
// round that is working on it.
func autoGroupCollections(ctx context.Context) {
	if !posters().Enabled() || time.Since(lastCollectionScan) < autoCollectionEvery {
		return
	}
	autoMu.Lock()
	idle := len(autoActive) == 0
	autoMu.Unlock()
	if !idle {
		return
	}
	lastCollectionScan = time.Now()
	for _, root := range posters().Config().Paths {
		if root == "/" || !posters().InLibrary(root) {
			continue
		}
		groups, err := groupCollectionsIn(ctx, root, true)
		if err != nil {
			log.Warnf("tgvio collections %s: %v", root, err)
			continue
		}
		for _, g := range groups {
			if g.Moved {
				log.Infof("tgvio collections: %s -> %s/%s", strings.Join(g.Members, ", "), root, g.Target)
			}
		}
	}
}

const autoCollectionEvery = 30 * time.Minute
