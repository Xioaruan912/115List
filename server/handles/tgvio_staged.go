package handles

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	stdpath "path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/OpenListTeam/OpenList/v4/cmd/flags"
	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/errs"
	"github.com/OpenListTeam/OpenList/v4/internal/fs"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/internal/stream"
	"github.com/OpenListTeam/OpenList/v4/pkg/utils"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
)

// Staged uploads: resumable across closed browsers and server restarts.
//
// The multipart API streams chunks straight into the drive's upload, so a
// session cannot outlive the browser for long. Here chunks land in one file in
// <data>/tgvio/staged/<id>.part at their offsets, and <id>.json records which
// arrived. Days later the same user picks the same file again, the browser asks
// what is missing and sends only that. When every chunk is in, the file is
// handed to an upload task as it is (no second copy) and removed afterwards.

const (
	stagedChunk    = 8 << 20
	stagedTTL      = 72 * time.Hour
	stagedHeadroom = 2 << 30 // keep this much disk free
)

type stagedSession struct {
	ID        string    `json:"id"`
	UserID    uint      `json:"user_id"`
	Path      string    `json:"path"` // real path, user base included
	Shown     string    `json:"shown"`
	Size      int64     `json:"size"`
	ChunkSize int64     `json:"chunk_size"`
	Modified  int64     `json:"modified"` // the file's own mtime, ms
	Mimetype  string    `json:"mimetype"`
	Overwrite bool      `json:"overwrite"`
	Have      []byte    `json:"have"` // one byte per chunk
	Created   time.Time `json:"created"`
	Updated   time.Time `json:"updated"`
	Done      bool      `json:"done"`

	mu sync.Mutex
}

type stagedSnapshot struct {
	UploadID      string    `json:"upload_id"`
	Name          string    `json:"name"`
	Path          string    `json:"path"`
	Size          int64     `json:"size"`
	Modified      int64     `json:"modified"`
	ChunkSize     int64     `json:"chunk_size"`
	TotalChunks   int       `json:"total_chunks"`
	Received      [][2]int  `json:"received"`
	ReceivedBytes int64     `json:"received_bytes"`
	Updated       time.Time `json:"updated"`
	Task          *TaskInfo `json:"task,omitempty"`
}

var staged = struct {
	sync.Mutex
	byID   map[string]*stagedSession
	loaded bool
}{byID: map[string]*stagedSession{}}

// Not the temp dir: OpenList empties that on every start.
func stagedDir() string { return filepath.Join(flags.DataDir, "tgvio", "staged") }

func (s *stagedSession) total() int { return int((s.Size + s.ChunkSize - 1) / s.ChunkSize) }

func (s *stagedSession) chunkLen(i int) int64 {
	if i == s.total()-1 {
		return s.Size - int64(i)*s.ChunkSize
	}
	return s.ChunkSize
}

func (s *stagedSession) snapshot() stagedSnapshot {
	snap := stagedSnapshot{UploadID: s.ID, Name: stdpath.Base(s.Shown), Path: s.Shown, Size: s.Size, Modified: s.Modified,
		ChunkSize: s.ChunkSize, TotalChunks: s.total(), Updated: s.Updated, Received: [][2]int{}}
	start := -1
	for i, have := range s.Have {
		if have == 1 {
			snap.ReceivedBytes += s.chunkLen(i)
			if start < 0 {
				start = i
			}
		} else if start >= 0 {
			snap.Received = append(snap.Received, [2]int{start, i - 1})
			start = -1
		}
	}
	if start >= 0 {
		snap.Received = append(snap.Received, [2]int{start, len(s.Have) - 1})
	}
	return snap
}

func (s *stagedSession) save() error {
	raw, err := json.Marshal(s)
	if err != nil {
		return err
	}
	tmp := filepath.Join(stagedDir(), s.ID+".json.tmp")
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(stagedDir(), s.ID+".json"))
}

func (s *stagedSession) partPath() string { return filepath.Join(stagedDir(), s.ID+".part") }

func (s *stagedSession) remove() {
	_ = os.Remove(filepath.Join(stagedDir(), s.ID+".json"))
	_ = os.Remove(s.partPath())
}

// loadStaged reads the sessions left by a previous run and drops expired ones.
func loadStaged() {
	staged.Lock()
	defer staged.Unlock()
	if staged.loaded {
		return
	}
	staged.loaded = true
	_ = os.MkdirAll(stagedDir(), 0o700)
	entries, _ := os.ReadDir(stagedDir())
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(stagedDir(), entry.Name()))
		var s stagedSession
		if err != nil || json.Unmarshal(raw, &s) != nil || s.ID == "" {
			continue
		}
		if s.Done || time.Since(s.Updated) > stagedTTL {
			s.remove()
			continue
		}
		staged.byID[s.ID] = &s
	}
	go func() {
		for range time.Tick(time.Hour) {
			staged.Lock()
			for id, s := range staged.byID {
				s.mu.Lock()
				expired := !s.Done && time.Since(s.Updated) > stagedTTL
				s.mu.Unlock()
				if expired {
					s.remove()
					delete(staged.byID, id)
				}
			}
			staged.Unlock()
		}
	}()
}

func stagedFor(c *gin.Context, id string) (*stagedSession, bool) {
	loadStaged()
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	staged.Lock()
	s, ok := staged.byID[id]
	staged.Unlock()
	if !ok || s.UserID != user.ID {
		common.ErrorStrResp(c, "upload session not found", 404)
		return nil, false
	}
	return s, true
}

func freeBytes(dir string) int64 {
	var st syscall.Statfs_t
	if syscall.Statfs(dir, &st) != nil {
		return -1
	}
	return int64(st.Bavail) * int64(st.Bsize)
}

// TgvioStagedInit: POST /api/fs/staged/init, headers like /fs/put (File-Path, X-File-Size, Overwrite, Last-Modified)
// The same user, path, size and modification time resume the session they left.
func TgvioStagedInit(c *gin.Context) {
	loadStaged()
	shown, err := url.PathUnescape(c.GetHeader("File-Path"))
	if err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	path, err := user.JoinPath(shown)
	if err != nil {
		common.ErrorResp(c, err, 403)
		return
	}
	size, err := strconv.ParseInt(c.GetHeader("X-File-Size"), 10, 64)
	if err != nil || size <= 0 {
		common.ErrorStrResp(c, "a positive X-File-Size is required", 400)
		return
	}
	modified, _ := strconv.ParseInt(c.GetHeader("Last-Modified"), 10, 64)
	overwrite := c.GetHeader("Overwrite") != "false"
	dir, name := stdpath.Split(path)
	if shouldIgnoreSystemFile(name) {
		common.ErrorStrResp(c, errs.IgnoredSystemFile.Error(), 403)
		return
	}
	storage, _, err := op.GetStorageAndActualPath(dir)
	if err != nil {
		common.ErrorResp(c, err, 500)
		return
	}
	if storage.Config().NoUpload {
		common.ErrorResp(c, errs.UploadNotSupported, 405)
		return
	}

	staged.Lock()
	for _, s := range staged.byID {
		s.mu.Lock()
		same := s.UserID == user.ID && s.Path == path && s.Size == size && s.Modified == modified && !s.Done
		var snap stagedSnapshot
		if same {
			s.Updated = time.Now()
			snap = s.snapshot()
		}
		s.mu.Unlock()
		if same {
			staged.Unlock()
			common.SuccessResp(c, gin.H{"resumed": true, "session": snap})
			return
		}
	}
	staged.Unlock()

	if !overwrite {
		if res, _ := fs.Get(c.Request.Context(), path, &fs.GetArgs{NoLog: true}); res != nil {
			common.ErrorStrResp(c, "file exists", 403)
			return
		}
	}
	if free := freeBytes(stagedDir()); free >= 0 && free-size < stagedHeadroom {
		common.ErrorStrResp(c, fmt.Sprintf("not enough space on the server for a %d MB staged upload", size>>20), 507)
		return
	}
	raw := make([]byte, 12)
	_, _ = rand.Read(raw)
	mimetype := c.GetHeader("Content-Type")
	if mimetype == "" || mimetype == "application/octet-stream" {
		mimetype = utils.GetMimeType(name)
	}
	s := &stagedSession{ID: hex.EncodeToString(raw), UserID: user.ID, Path: path, Shown: shown, Size: size, ChunkSize: stagedChunk,
		Modified: modified, Mimetype: mimetype, Overwrite: overwrite, Created: time.Now(), Updated: time.Now()}
	s.Have = make([]byte, s.total())
	file, err := os.OpenFile(s.partPath(), os.O_CREATE|os.O_RDWR|os.O_TRUNC, 0o600)
	if err == nil {
		err = file.Truncate(size)
		_ = file.Close()
	}
	if err == nil {
		err = s.save()
	}
	if err != nil {
		s.remove()
		common.ErrorResp(c, err, 500)
		return
	}
	staged.Lock()
	staged.byID[s.ID] = s
	staged.Unlock()
	common.SuccessResp(c, gin.H{"resumed": false, "session": s.snapshot()})
}

// TgvioStagedChunk: PUT /api/fs/staged/chunk, headers X-Upload-Id, X-Chunk-Index; the body is the chunk.
func TgvioStagedChunk(c *gin.Context) {
	s, ok := stagedFor(c, c.GetHeader("X-Upload-Id"))
	if !ok {
		return
	}
	index, err := strconv.Atoi(c.GetHeader("X-Chunk-Index"))
	if err != nil || index < 0 || index >= s.total() {
		common.ErrorStrResp(c, "bad X-Chunk-Index", 400)
		return
	}
	want := s.chunkLen(index)
	buf := make([]byte, want)
	n, err := io.ReadFull(c.Request.Body, buf)
	if err != nil || int64(n) != want {
		common.ErrorStrResp(c, fmt.Sprintf("chunk %d: expected %d bytes, got %d", index, want, n), 400)
		return
	}
	file, err := os.OpenFile(s.partPath(), os.O_WRONLY, 0o600)
	if err == nil {
		_, err = file.WriteAt(buf, int64(index)*s.ChunkSize)
		if cerr := file.Close(); err == nil {
			err = cerr
		}
	}
	if err != nil {
		common.ErrorResp(c, err, 500)
		return
	}
	s.mu.Lock()
	s.Have[index] = 1
	s.Updated = time.Now()
	err = s.save()
	snap := s.snapshot()
	s.mu.Unlock()
	if err != nil {
		common.ErrorResp(c, err, 500)
		return
	}
	common.SuccessResp(c, snap)
}

// TgvioStagedStatus: GET /api/fs/staged/status?upload_id=
func TgvioStagedStatus(c *gin.Context) {
	s, ok := stagedFor(c, c.Query("upload_id"))
	if !ok {
		return
	}
	s.mu.Lock()
	snap := s.snapshot()
	s.mu.Unlock()
	common.SuccessResp(c, snap)
}

// TgvioStagedList: GET /api/fs/staged/list, the caller's unfinished uploads.
func TgvioStagedList(c *gin.Context) {
	loadStaged()
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	out := []stagedSnapshot{}
	staged.Lock()
	for _, s := range staged.byID {
		s.mu.Lock()
		if s.UserID == user.ID && !s.Done {
			out = append(out, s.snapshot())
		}
		s.mu.Unlock()
	}
	staged.Unlock()
	common.SuccessResp(c, out)
}

// TgvioStagedComplete: POST /api/fs/staged/complete, header X-Upload-Id.
// Hands the finished file to an upload task; the task reads it in place.
func TgvioStagedComplete(c *gin.Context) {
	s, ok := stagedFor(c, c.GetHeader("X-Upload-Id"))
	if !ok {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, have := range s.Have {
		if have != 1 {
			common.ErrorStrResp(c, fmt.Sprintf("chunk %d has not arrived yet", i), 409)
			return
		}
	}
	file, err := os.Open(s.partPath())
	if err != nil {
		common.ErrorResp(c, err, 500)
		return
	}
	dir, name := stdpath.Split(s.Path)
	part := s.partPath()
	fileStream := &stream.FileStream{
		Obj:          &model.Object{Name: name, Size: s.Size, Modified: time.UnixMilli(s.Modified)},
		Reader:       file, // an *os.File: the task uses it without copying it again
		Mimetype:     s.Mimetype,
		WebPutAsTask: true,
	}
	if s.Modified == 0 {
		fileStream.Obj.(*model.Object).Modified = time.Now()
	}
	fileStream.Closers.Add(utils.CloseFunc(func() error {
		_ = file.Close()
		return os.Remove(part)
	}))
	t, err := fs.PutAsTask(c.Request.Context(), dir, fileStream)
	if err != nil {
		_ = file.Close()
		common.ErrorResp(c, err, 500)
		return
	}
	s.Done = true
	_ = os.Remove(filepath.Join(stagedDir(), s.ID+".json"))
	staged.Lock()
	delete(staged.byID, s.ID)
	staged.Unlock()
	snap := s.snapshot()
	if t != nil {
		info := getTaskInfo(t)
		snap.Task = &info
	}
	log.Infof("staged upload %s complete: %s (%d bytes)", s.ID, s.Path, s.Size)
	common.SuccessResp(c, snap)
}

// TgvioStagedAbort: POST /api/fs/staged/abort, header X-Upload-Id.
func TgvioStagedAbort(c *gin.Context) {
	s, ok := stagedFor(c, c.GetHeader("X-Upload-Id"))
	if !ok {
		return
	}
	s.mu.Lock()
	s.remove()
	s.mu.Unlock()
	staged.Lock()
	delete(staged.byID, s.ID)
	staged.Unlock()
	common.SuccessResp(c)
}
