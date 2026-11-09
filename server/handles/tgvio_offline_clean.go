package handles

import (
	"time"

	_115 "github.com/OpenListTeam/OpenList/v4/drivers/115"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
)

// TGVIO: 115's cloud download keeps a record of every task, finished or failed,
// and answers "任务已存在" (10008) when the same link is added again — so
// deleting a folder and downloading it once more does nothing. Cleaning those
// records (without touching the files) lets the download run again.

type offlineCleanReq struct {
	// All also removes records 115 still has queued or running; by default only
	// finished and failed ones go.
	All bool `json:"all"`
}

// TgvioOfflineClean: POST /api/admin/tgvio/offline/clean {all}
func TgvioOfflineClean(c *gin.Context) {
	var req offlineCleanReq
	_ = c.ShouldBindJSON(&req)
	ctx := c.Request.Context()
	removed, kept, failed, drives := 0, 0, 0, 0
	var lastKept []string
	for _, storage := range op.GetAllStorages() {
		pan, ok := storage.(*_115.Pan115)
		if !ok {
			continue
		}
		drives++
		// 115 deletes asynchronously and lists one page: a round can reveal the
		// next, so keep going while something is still being removed.
		for round := 0; round < 6; round++ {
			tasks, err := pan.OfflineList(ctx)
			if err != nil {
				log.Warnf("tgvio offline clean: list %s: %v", pan.GetStorage().MountPath, err)
				failed++
				break
			}
			hashes := make([]string, 0, len(tasks))
			keptNow := 0
			for _, task := range tasks {
				if task.InfoHash == "" {
					continue
				}
				if !req.All && !task.IsDone() && !task.IsFailed() {
					keptNow++
					if len(lastKept) < 8 {
						lastKept = append(lastKept, task.Name+"（"+task.GetStatus()+"）")
					}
					continue
				}
				hashes = append(hashes, task.InfoHash)
			}
			if round == 0 {
				kept += keptNow
			}
			if len(hashes) == 0 {
				break
			}
			if err := pan.DeleteOfflineTasks(ctx, hashes, false); err != nil {
				log.Warnf("tgvio offline clean: delete %s: %v", pan.GetStorage().MountPath, err)
				failed++
				break
			}
			removed += len(hashes)
			time.Sleep(300 * time.Millisecond)
		}
	}
	common.SuccessResp(c, gin.H{"removed": removed, "kept": kept, "drives": drives, "failed": failed, "keptNames": lastKept})
}
