package handles

import (
	"strconv"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
)

// Signed-in devices (server/common/tgvio_sessions.go).

type deviceOut struct {
	common.DeviceSession
	Current bool `json:"current"`
}

func devicesFor(c *gin.Context, userID uint) []deviceOut {
	current := common.SessionIDOf(c.GetHeader("Authorization"))
	out := []deviceOut{}
	for _, s := range common.DeviceSessions(userID) {
		out = append(out, deviceOut{DeviceSession: s, Current: s.ID == current})
	}
	return out
}

// TgvioMyDevices: GET /api/me/devices
func TgvioMyDevices(c *gin.Context) {
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	common.SuccessResp(c, gin.H{"devices": devicesFor(c, user.ID), "idle_days": common.GetSessionConfig().IdleDays})
}

type deviceRevokeReq struct {
	ID     string `json:"id"`
	Others bool   `json:"others"` // every device but this one
	UserID uint   `json:"user_id"`
	All    bool   `json:"all"` // admin: every device of user_id
}

// TgvioMyDeviceRevoke: POST /api/me/devices/revoke {id} or {others: true}
func TgvioMyDeviceRevoke(c *gin.Context) {
	var req deviceRevokeReq
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	if req.Others {
		n := common.RevokeUserSessions(user.ID, common.SessionIDOf(c.GetHeader("Authorization")))
		common.SuccessResp(c, gin.H{"revoked": n})
		return
	}
	s, ok := common.DeviceSessionOf(req.ID)
	if !ok || s.UserID != user.ID {
		common.ErrorStrResp(c, "device not found", 404)
		return
	}
	common.RevokeDeviceSession(req.ID)
	common.SuccessResp(c, gin.H{"revoked": 1})
}

// TgvioDevices: GET /api/admin/tgvio/devices?user_id= (0 or absent: everyone)
func TgvioDevices(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Query("user_id"), 10, 64)
	common.SuccessResp(c, gin.H{"devices": devicesFor(c, uint(id)), "idle_days": common.GetSessionConfig().IdleDays})
}

// TgvioDeviceRevoke: POST /api/admin/tgvio/devices/revoke {id} or {user_id, all: true}
func TgvioDeviceRevoke(c *gin.Context) {
	var req deviceRevokeReq
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	if req.All && req.UserID > 0 {
		common.SuccessResp(c, gin.H{"revoked": common.RevokeUserSessions(req.UserID, "")})
		return
	}
	if !common.RevokeDeviceSession(req.ID) {
		common.ErrorStrResp(c, "device not found", 404)
		return
	}
	common.SuccessResp(c, gin.H{"revoked": 1})
}

type sessionConfigReq struct {
	IdleDays int `json:"idle_days"`
}

// TgvioSessionConfig: GET/POST /api/admin/tgvio/sessions {idle_days}
func TgvioSessionConfig(c *gin.Context) {
	if c.Request.Method == "POST" {
		var req sessionConfigReq
		if err := c.ShouldBindJSON(&req); err != nil || req.IdleDays <= 0 {
			common.ErrorStrResp(c, "idle_days must be positive", 400)
			return
		}
		common.SetSessionConfig(common.SessionConfig{IdleDays: req.IdleDays})
	}
	common.SuccessResp(c, common.GetSessionConfig())
}
