package handles

import (
	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/internal/setting"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
)

// Folder passwords (metas) never stop a user with the 免密访问 permission, and
// the admin has it. TGVIO's Player and workers read the drive over WebDAV as
// that admin, so the permission must stay. With tgvio_admin_folder_password on,
// the web API alone asks the admin for folder passwords like anyone else.

const noPasswordBit = 1

// webCanAccess is common.CanAccess for the web front end's endpoints.
func webCanAccess(user *model.User, meta *model.Meta, reqPath string, password string) bool {
	if user != nil && user.IsAdmin() && user.CanAccessWithoutPassword() && setting.GetBool(conf.TgvioAdminFolderPassword) {
		locked := *user
		locked.Permission &^= 1 << noPasswordBit
		return common.CanAccess(&locked, meta, reqPath, password)
	}
	return common.CanAccess(user, meta, reqPath, password)
}

type folderLockReq struct {
	Enabled bool `json:"enabled"`
}

// TgvioFolderLock: GET/POST /api/admin/tgvio/folder_lock
func TgvioFolderLock(c *gin.Context) {
	if c.Request.Method == "POST" {
		var req folderLockReq
		if err := c.ShouldBindJSON(&req); err != nil {
			common.ErrorResp(c, err, 400)
			return
		}
		item, err := op.GetSettingItemByKey(conf.TgvioAdminFolderPassword)
		if err != nil {
			common.ErrorResp(c, err, 500)
			return
		}
		item.Value = "false"
		if req.Enabled {
			item.Value = "true"
		}
		if err := op.SaveSettingItem(item); err != nil {
			common.ErrorResp(c, err, 500)
			return
		}
	}
	common.SuccessResp(c, gin.H{"enabled": setting.GetBool(conf.TgvioAdminFolderPassword)})
}
