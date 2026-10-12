package handles

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/driver"
	"github.com/OpenListTeam/OpenList/v4/internal/errs"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/internal/tgvio"
	"github.com/OpenListTeam/OpenList/v4/pkg/utils"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
)

// Cloud playback of videos the drive transcoded itself (115).
//
// POST /api/tgvio/video checks access like /api/fs/get (or a share's code for
// share visitors) and answers with the available qualities and a ticket. The
// ticket is a random, unguessable key for the real path that expires after
// 12 hours; the player then asks /tgvio/hls/<ticket>/<quality>/index.m3u8 and
// its segments. The real path never appears in a URL, so a share does not leak
// where its files live.

const ticketTTL = 12 * time.Hour

type videoTicket struct {
	path    string
	expires time.Time
	storage driver.Driver
	obj     model.Obj
}

var videoTickets = struct {
	sync.Mutex
	m map[string]*videoTicket
}{m: map[string]*videoTicket{}}

func issueTicket(path string) string {
	raw := make([]byte, 18)
	_, _ = rand.Read(raw)
	id := base64.RawURLEncoding.EncodeToString(raw)
	videoTickets.Lock()
	defer videoTickets.Unlock()
	now := time.Now()
	if len(videoTickets.m) > 2000 {
		for key, t := range videoTickets.m {
			if now.After(t.expires) {
				delete(videoTickets.m, key)
			}
		}
	}
	videoTickets.m[id] = &videoTicket{path: path, expires: now.Add(ticketTTL)}
	return id
}

func lookupTicket(id string) (*videoTicket, bool) {
	videoTickets.Lock()
	defer videoTickets.Unlock()
	t, ok := videoTickets.m[id]
	if !ok || time.Now().After(t.expires) {
		return nil, false
	}
	return t, true
}

type tgvioVideoReq struct {
	Path     string `json:"path" form:"path"`
	Password string `json:"password" form:"password"`
	Share    string `json:"share" form:"share"`
	SharePwd string `json:"share_pwd" form:"share_pwd"`
}

// resolveVideoPath turns the request into a real path the caller may read.
func resolveVideoPath(c *gin.Context, req *tgvioVideoReq) (string, int, error) {
	if req.Share != "" {
		s, err := op.GetSharingById(req.Share)
		if err != nil {
			return "", 404, errs.SharingNotFound
		}
		if !s.Valid() {
			return "", 410, errs.InvalidSharing
		}
		if !s.Verify(req.SharePwd) {
			return "", 403, errs.WrongShareCode
		}
		path := utils.FixAndCleanPath(req.Path)
		if len(s.Files) != 1 && path == "/" {
			return "", 400, errors.New("not a file")
		}
		real, err := op.GetSharingUnwrapPath(s, path)
		return real, 500, err
	}
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	if user.IsGuest() && user.Disabled {
		return "", 401, errors.New("Guest user is disabled, login please")
	}
	real, err := user.JoinPath(req.Path)
	if err != nil {
		return "", 403, err
	}
	meta, err := op.GetNearestMeta(real)
	if err != nil && !errors.Is(errors.Cause(err), errs.MetaNotFound) {
		return "", 500, err
	}
	if !common.CanAccess(user, meta, real, req.Password) {
		return "", 403, errors.New("password is incorrect or you have no permission")
	}
	return real, 200, nil
}

// TgvioVideo: POST /api/tgvio/video {path, password} or {share, share_pwd, path}
func TgvioVideo(c *gin.Context) {
	var req tgvioVideoReq
	if err := c.ShouldBind(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	real, code, err := resolveVideoPath(c, &req)
	if err != nil {
		common.ErrorResp(c, err, code)
		return
	}
	storage, actual, err := op.GetStorageAndActualPath(real)
	if err != nil {
		common.ErrorResp(c, err, 404)
		return
	}
	cloud, ok := storage.(tgvio.CloudVideo)
	if !ok {
		common.SuccessResp(c, gin.H{"qualities": []tgvio.CloudQuality{}})
		return
	}
	obj, err := op.Get(c.Request.Context(), storage, actual)
	if err != nil {
		common.ErrorResp(c, err, 404)
		return
	}
	qualities, err := cloud.CloudQualities(c.Request.Context(), obj)
	if err != nil || len(qualities) == 0 {
		reason := ""
		if err != nil {
			reason = err.Error()
		}
		common.SuccessResp(c, gin.H{"qualities": []tgvio.CloudQuality{}, "reason": reason})
		return
	}
	ticket := issueTicket(real)
	videoTickets.Lock()
	videoTickets.m[ticket].storage, videoTickets.m[ticket].obj = storage, obj
	videoTickets.Unlock()
	common.SuccessResp(c, gin.H{"qualities": qualities, "ticket": ticket})
}

// mediaPlaylist is the drive's playlist with every segment pointing back here
// by its index, so the browser never sees a drive URL.
func mediaPlaylist(playlist *tgvio.CloudPlaylist) string {
	var b strings.Builder
	fmt.Fprintf(&b, "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-TARGETDURATION:%d\n#EXT-X-MEDIA-SEQUENCE:0\n", playlist.TargetDuration)
	for i, segment := range playlist.Segments {
		fmt.Fprintf(&b, "#EXTINF:%.3f,\n%d.ts\n", segment.Duration, i)
	}
	b.WriteString("#EXT-X-ENDLIST\n")
	return b.String()
}

// TgvioHLS: GET /tgvio/hls/:ticket/:quality/index.m3u8 and /:n.ts
func TgvioHLS(c *gin.Context) {
	ticket, ok := lookupTicket(c.Param("ticket"))
	if !ok {
		c.String(http.StatusGone, "playback ticket expired")
		return
	}
	videoTickets.Lock()
	storage, obj := ticket.storage, ticket.obj
	videoTickets.Unlock()
	cloud, ok := storage.(tgvio.CloudVideo)
	if !ok || obj == nil {
		c.String(http.StatusNotFound, "no cloud video")
		return
	}
	ctx := c.Request.Context()
	quality, file := c.Param("quality"), c.Param("file")
	playlist, err := cloud.CloudPlaylist(ctx, obj, quality)
	if err != nil {
		c.String(http.StatusBadGateway, err.Error())
		return
	}
	// Nobody in between may keep these: the ticket is personal.
	c.Header("Cache-Control", "private, no-store")
	if file == "index.m3u8" {
		c.Data(http.StatusOK, "application/vnd.apple.mpegurl", []byte(mediaPlaylist(playlist)))
		return
	}
	index, err := strconv.Atoi(strings.TrimSuffix(file, ".ts"))
	if err != nil || !strings.HasSuffix(file, ".ts") || index < 0 || index >= len(playlist.Segments) {
		c.String(http.StatusNotFound, "no such segment")
		return
	}
	resp, err := cloud.CloudSegmentGet(ctx, playlist.Segments[index].URL, c.GetHeader("Range"))
	if err == nil && (resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone) {
		// The segment links went stale: fetch the playlist again, once.
		resp.Body.Close()
		cloud.CloudForget(obj, quality)
		if playlist, err = cloud.CloudPlaylist(ctx, obj, quality); err == nil && index < len(playlist.Segments) {
			resp, err = cloud.CloudSegmentGet(ctx, playlist.Segments[index].URL, c.GetHeader("Range"))
		}
	}
	if err != nil {
		c.String(http.StatusBadGateway, err.Error())
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		c.String(http.StatusBadGateway, "segment: HTTP %d", resp.StatusCode)
		return
	}
	for _, key := range []string{"Content-Length", "Content-Range", "Accept-Ranges"} {
		if value := resp.Header.Get(key); value != "" {
			c.Header(key, value)
		}
	}
	c.Header("Content-Type", "video/mp2t")
	c.Header("Cache-Control", "private, max-age=3600")
	c.Status(resp.StatusCode)
	_, _ = io.Copy(c.Writer, resp.Body)
}
