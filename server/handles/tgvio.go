package handles

import (
	"sync"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/driver"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/internal/tgvio"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
)

// TGVIO monitoring and recycle-bin endpoints. The drive is named by its driver
// ("115 Cloud"); every 115 storage of the account shares one quota and one
// recycle bin, so the first working one answers.

const tgvioDrive = "115 Cloud"

func tgvioStorage() driver.Driver {
	for _, storage := range op.GetAllStorages() {
		if storage.Config().Name == tgvioDrive && storage.GetStorage().Status == op.WORK {
			return storage
		}
	}
	return nil
}

var tgvioSpace struct {
	sync.Mutex
	at    time.Time
	value gin.H
}

// The quota changes slowly and costs a drive call: read it at most every 10 min.
func tgvioSpaceInfo(c *gin.Context) gin.H {
	tgvioSpace.Lock()
	defer tgvioSpace.Unlock()
	if tgvioSpace.value != nil && time.Since(tgvioSpace.at) < 10*time.Minute {
		return tgvioSpace.value
	}
	storage, ok := tgvioStorage().(driver.WithDetails)
	if !ok {
		return gin.H{"error": "no working 115 storage"}
	}
	details, err := storage.GetDetails(c.Request.Context())
	if err != nil {
		return gin.H{"error": err.Error()}
	}
	total, used := details.DiskUsage.TotalSpace, details.DiskUsage.UsedSpace
	tgvioSpace.value = gin.H{"total_bytes": total, "used_bytes": used, "free_bytes": total - used}
	tgvioSpace.at = time.Now()
	return tgvioSpace.value
}

// TgvioStats: GET /api/tgvio/stats
func TgvioStats(c *gin.Context) {
	started := tgvio.StartedAt()
	common.SuccessResp(c, gin.H{
		"started_at":     started.UTC().Format(time.RFC3339),
		"uptime_seconds": int64(time.Since(started).Seconds()),
		"counters":       tgvio.Counters(),
		"state":          tgvio.State(),
		"space":          tgvioSpaceInfo(c),
	})
}

func tgvioRecycleBin(c *gin.Context) (driver.RecycleBin, bool) {
	bin, ok := tgvioStorage().(driver.RecycleBin)
	if !ok {
		common.ErrorStrResp(c, "no working 115 storage", 503)
	}
	return bin, ok
}

type tgvioRecycleQuery struct {
	Offset int `form:"offset"`
	Limit  int `form:"limit"`
}

// TgvioRecycleList: GET /api/admin/tgvio/recycle?offset=&limit= (limit 1..1000)
func TgvioRecycleList(c *gin.Context) {
	var query tgvioRecycleQuery
	if err := c.ShouldBindQuery(&query); err != nil || query.Offset < 0 || query.Limit < 0 || query.Limit > 1000 {
		common.ErrorStrResp(c, "invalid offset or limit", 400)
		return
	}
	if query.Limit == 0 {
		query.Limit = 1000
	}
	bin, ok := tgvioRecycleBin(c)
	if !ok {
		return
	}
	items, err := bin.RecycleList(c.Request.Context(), query.Offset, query.Limit)
	if err != nil {
		common.ErrorResp(c, err, 502)
		return
	}
	var total int64
	for _, item := range items {
		total += item.Size
	}
	common.SuccessResp(c, gin.H{"items": items, "page_bytes": total, "has_more": len(items) == query.Limit})
}

type tgvioRecycleCleanReq struct {
	IDs []string `json:"ids"`
}

// TgvioRecycleClean: POST /api/admin/tgvio/recycle/clean {"ids": [...]}
// Only the listed entries are removed, never the whole bin.
func TgvioRecycleClean(c *gin.Context) {
	var req tgvioRecycleCleanReq
	if err := c.ShouldBindJSON(&req); err != nil || len(req.IDs) == 0 || len(req.IDs) > 1000 {
		common.ErrorStrResp(c, "give 1 to 1000 recycle bin ids", 400)
		return
	}
	for _, id := range req.IDs {
		if id == "" {
			common.ErrorStrResp(c, "empty recycle bin id", 400)
			return
		}
	}
	bin, ok := tgvioRecycleBin(c)
	if !ok {
		return
	}
	if err := bin.RecycleClean(c.Request.Context(), req.IDs); err != nil {
		common.ErrorResp(c, err, 502)
		return
	}
	tgvio.Add("115_recycle_cleaned", int64(len(req.IDs)))
	common.SuccessResp(c, gin.H{"cleaned": len(req.IDs)})
}
