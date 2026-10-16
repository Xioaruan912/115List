package handles

import (
	"encoding/json"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/driver"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/internal/tgvio"
	"github.com/OpenListTeam/OpenList/v4/pkg/utils"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
)

// TGVIO: mount a 115 folder by clicking through the drive instead of looking up
// its folder id. An existing 115 storage lends its signed-in account: the admin
// browses that account's folders and the new storage copies its settings with
// another root, so the cookie is never typed again and never leaves the server.

type tgvioMountSource struct {
	ID        uint   `json:"id"`
	MountPath string `json:"mount_path"`
	Status    string `json:"status"`
	Root      string `json:"root"`
}

func tgvio115Storages() []driver.Driver {
	out := []driver.Driver{}
	for _, d := range op.GetAllStorages() {
		if d.Config().Name == tgvioDrive {
			out = append(out, d)
		}
	}
	return out
}

func rootFolderOf(addition string) string {
	var fields map[string]any
	if json.Unmarshal([]byte(addition), &fields) != nil {
		return ""
	}
	switch v := fields["root_folder_id"].(type) {
	case string:
		return v
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	}
	return ""
}

func tgvioMountSources() []tgvioMountSource {
	out := []tgvioMountSource{}
	for _, d := range tgvio115Storages() {
		st := d.GetStorage()
		root := rootFolderOf(st.Addition)
		if root == "" {
			root = "0"
		}
		out = append(out, tgvioMountSource{ID: st.ID, MountPath: st.MountPath, Status: st.Status, Root: root})
	}
	return out
}

// TgvioMountSources: GET /api/admin/tgvio/115/sources, the 115 storages whose
// account can be browsed, with the folder each one mounts.
func TgvioMountSources(c *gin.Context) {
	common.SuccessResp(c, tgvioMountSources())
}

var tgvioFolderCache = struct {
	sync.Mutex
	m map[string]tgvioFolderEntry
}{m: map[string]tgvioFolderEntry{}}

type tgvioFolderEntry struct {
	at      time.Time
	folders []tgvio.DriveFolder
}

// TgvioMountFolders: GET /api/admin/tgvio/115/folders?source=<storage id>&id=<folder id>
// lists the folders under one 115 folder ("0" is the drive's root). Listings are
// kept for two minutes, so clicking back and forth costs no further drive calls.
func TgvioMountFolders(c *gin.Context) {
	source, _ := strconv.ParseUint(c.Query("source"), 10, 64)
	id := strings.TrimSpace(c.Query("id"))
	if id == "" {
		id = "0"
	}
	var browser driver.FolderBrowser
	for _, d := range tgvio115Storages() {
		if uint64(d.GetStorage().ID) == source {
			if d.GetStorage().Status != op.WORK {
				common.ErrorStrResp(c, "this storage is not working: "+d.GetStorage().Status, 400)
				return
			}
			browser, _ = d.(driver.FolderBrowser)
		}
	}
	if browser == nil {
		common.ErrorStrResp(c, "no such 115 storage", 400)
		return
	}
	key := strconv.FormatUint(source, 10) + ":" + id
	tgvioFolderCache.Lock()
	entry, ok := tgvioFolderCache.m[key]
	tgvioFolderCache.Unlock()
	if !ok || time.Since(entry.at) > 2*time.Minute || c.Query("refresh") == "1" {
		folders, err := browser.DriveFolders(c.Request.Context(), id)
		if err != nil {
			common.ErrorResp(c, err, 500)
			return
		}
		entry = tgvioFolderEntry{at: time.Now(), folders: folders}
		tgvioFolderCache.Lock()
		tgvioFolderCache.m[key] = entry
		tgvioFolderCache.Unlock()
	}
	common.SuccessResp(c, gin.H{"folders": entry.folders, "sources": tgvioMountSources()})
}

type tgvioMountReq struct {
	Source    uint   `json:"source"`
	ID        string `json:"id"`
	MountPath string `json:"mount_path"`
}

// TgvioMount: POST /api/admin/tgvio/115/mount {source, id, mount_path} creates a
// 115 storage like the source one, rooted at the chosen folder.
func TgvioMount(c *gin.Context) {
	var req tgvioMountReq
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	req.ID = strings.TrimSpace(req.ID)
	req.MountPath = utils.FixAndCleanPath(strings.TrimSpace(req.MountPath))
	if req.ID == "" || req.MountPath == "/" {
		common.ErrorStrResp(c, "choose a folder and a mount path", 400)
		return
	}
	var source driver.Driver
	order := 0
	for _, d := range op.GetAllStorages() {
		st := d.GetStorage()
		if st.MountPath == req.MountPath {
			common.ErrorStrResp(c, "mount path already used: "+req.MountPath, 400)
			return
		}
		if st.Order >= order {
			order = st.Order + 1
		}
		if st.ID == req.Source && d.Config().Name == tgvioDrive {
			source = d
		}
	}
	if source == nil {
		common.ErrorStrResp(c, "no such 115 storage", 400)
		return
	}
	storage := *source.GetStorage()
	var fields map[string]any
	if err := json.Unmarshal([]byte(storage.Addition), &fields); err != nil {
		common.ErrorResp(c, err, 500)
		return
	}
	fields["root_folder_id"] = req.ID
	addition, err := json.Marshal(fields)
	if err != nil {
		common.ErrorResp(c, err, 500)
		return
	}
	storage.ID = 0
	storage.MountPath = req.MountPath
	storage.Addition = string(addition)
	storage.Order = order
	storage.Status = ""
	storage.Remark = ""
	storage.Disabled = false
	id, err := op.CreateStorage(c.Request.Context(), storage)
	if err != nil {
		common.ErrorWithDataResp(c, err, 500, gin.H{"id": id}, true)
		return
	}
	common.SuccessResp(c, gin.H{"id": id, "mount_path": req.MountPath})
}
