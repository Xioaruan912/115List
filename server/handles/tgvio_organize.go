package handles

import (
	"github.com/OpenListTeam/OpenList/v4/cmd/flags"
	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/errs"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/tgvio"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
)

// TGVIO: folders waiting to be organized (internal/tgvio/organize.go).

func organizeStore() *tgvio.Organize { return tgvio.OrganizeStore(flags.DataDir) }

// TgvioOrganizePending: GET /api/tgvio/organize?dir= — folders directly in dir waiting (names) or organized (done), and dir's own state.
func TgvioOrganizePending(c *gin.Context) {
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	dir, err := user.JoinPath(c.Query("dir"))
	if err != nil {
		common.ErrorResp(c, errs.PermissionDenied, 403)
		return
	}
	pending, done, self := organizeStore().Children(dir)
	common.SuccessResp(c, gin.H{"names": pending, "done": done, "self": self})
}

type organizeReq struct {
	Paths   []string `json:"paths"`
	Pending bool     `json:"pending"`
}

// TgvioOrganizeMark: POST /api/tgvio/organize {paths, pending} — pending, or organized (false).
func TgvioOrganizeMark(c *gin.Context) {
	var req organizeReq
	if err := c.ShouldBindJSON(&req); err != nil || len(req.Paths) > 200 {
		common.ErrorStrResp(c, "bad request", 400)
		return
	}
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	for _, p := range req.Paths {
		real, err := user.JoinPath(p)
		if err != nil || real == "/" {
			common.ErrorResp(c, errs.PermissionDenied, 403)
			return
		}
		if err := organizeStore().Mark(real, req.Pending); err != nil {
			common.ErrorResp(c, err, 500)
			return
		}
	}
	common.SuccessResp(c)
}
