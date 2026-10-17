package handles

import (
	"github.com/OpenListTeam/OpenList/v4/cmd/flags"
	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/tgvio"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
)

// TGVIO: watch progress kept per user on the server (internal/tgvio/progress.go),
// so "继续观看" and the progress bars follow a person between devices.

func watching() *tgvio.WatchStore { return tgvio.Watching(flags.DataDir) }

// TgvioProgress: GET /api/tgvio/progress returns the user's entries.
func TgvioProgress(c *gin.Context) {
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	common.SuccessResp(c, gin.H{"items": watching().All(user.ID)})
}

type progressReq struct {
	Items map[string]tgvio.WatchEntry `json:"items"`
}

// TgvioProgressMerge: POST /api/tgvio/progress {items} merges the client's
// entries (newer wins) and returns the user's entries after the merge.
func TgvioProgressMerge(c *gin.Context) {
	var req progressReq
	if err := c.ShouldBindJSON(&req); err != nil || len(req.Items) > 500 {
		common.ErrorStrResp(c, "give up to 500 entries", 400)
		return
	}
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	common.SuccessResp(c, gin.H{"items": watching().Merge(user.ID, req.Items)})
}
