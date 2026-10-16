package handles

import (
	stdpath "path"
	"strings"

	"github.com/OpenListTeam/OpenList/v4/cmd/flags"
	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/errs"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/internal/tgvio"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
)

// TGVIO: pictures for videos whose drive lists none (internal/tgvio/thumbs.go).
// Episodes of a series known to TMDB show the episode's still; other videos get
// a frame of the drive's own transcoded copy, made in the background.

type thumbsReq struct {
	Dir      string   `json:"dir"`
	Password string   `json:"password"`
	Names    []string `json:"names"`
}

// TgvioThumbs: POST /api/tgvio/thumbs {dir, names} answers with the pictures
// known now and how many are still being made, so the page asks again.
func TgvioThumbs(c *gin.Context) {
	var req thumbsReq
	if err := c.ShouldBindJSON(&req); err != nil || len(req.Names) > 2000 {
		common.ErrorStrResp(c, "give up to 2000 names", 400)
		return
	}
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	dir, err := user.JoinPath(req.Dir)
	if err != nil {
		common.ErrorResp(c, err, 403)
		return
	}
	meta, err := op.GetNearestMeta(dir)
	if err != nil && !errors.Is(errors.Cause(err), errs.MetaNotFound) {
		common.ErrorResp(c, err, 500, true)
		return
	}
	if !webCanAccess(user, meta, dir, req.Password) {
		common.ErrorStrResp(c, "password is incorrect or you have no permission", 403)
		return
	}
	items := map[string]string{}
	pending := 0
	ctx := c.Request.Context()
	for name, still := range posters().EpisodeStills(ctx, dir, req.Names) {
		items[name] = posterURL("w300", still)
	}
	storage, actual, err := op.GetStorageAndActualPath(dir)
	cloud, isCloud := storage.(tgvio.CloudVideo)
	if err != nil || !isCloud {
		common.SuccessResp(c, gin.H{"items": items, "pending": 0})
		return
	}
	// The listing the page just showed: no drive call unless it has expired.
	objs, err := op.List(ctx, storage, actual, model.ListArgs{})
	if err != nil {
		common.ErrorResp(c, err, 500)
		return
	}
	byName := make(map[string]model.Obj, len(objs))
	for _, obj := range objs {
		byName[obj.GetName()] = obj
	}
	maker := tgvio.VideoThumbs(flags.DataDir)
	for _, name := range req.Names {
		obj, ok := byName[name]
		if !ok || obj.IsDir() || items[name] != "" || strings.HasSuffix(strings.ToLower(name), ".iso") {
			continue
		}
		key := tgvio.ThumbKey(storage.GetStorage().ID, stdpath.Join(actual, name), obj.GetSize(), obj.ModTime())
		ready, waiting := maker.Want(key, cloud, obj)
		if ready {
			items[name] = "/tgvio/thumb/" + key + ".jpg"
		} else if waiting {
			pending++
		}
	}
	common.SuccessResp(c, gin.H{"items": items, "pending": pending})
}

// TgvioThumbImage: GET /tgvio/thumb/:file serves a made thumbnail. Its name is
// a hash only handed out to people allowed to list the folder.
func TgvioThumbImage(c *gin.Context) {
	key, ok := tgvio.ThumbName(c.Param("file"))
	if !ok {
		c.Status(404)
		return
	}
	path, ok := tgvio.VideoThumbs(flags.DataDir).File(key)
	if !ok {
		c.Status(404)
		return
	}
	c.Header("Cache-Control", "private, max-age=31536000, immutable")
	c.File(path)
}
