package handles

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/OpenListTeam/OpenList/v4/cmd/flags"
	"github.com/OpenListTeam/OpenList/v4/drivers/local"
	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/db"
	"github.com/OpenListTeam/OpenList/v4/internal/driver"
	"github.com/OpenListTeam/OpenList/v4/internal/fs"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/tache"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestStagedFreeBytes(t *testing.T) {
	dir := t.TempDir()
	if free := freeBytes(dir); free <= 0 {
		t.Fatalf("available bytes for temporary directory = %d", free)
	}
	if free := freeBytes(filepath.Join(dir, "missing")); free != -1 {
		t.Fatalf("available bytes for missing directory = %d, want -1", free)
	}
}

type stagedTestDriver struct {
	local.Local
	fail    bool
	bodies  []string
	entered chan struct{}
	release chan struct{}
}

func (d *stagedTestDriver) Config() driver.Config {
	c := d.Local.Config()
	c.Name = "StagedTest"
	return c
}
func (d *stagedTestDriver) Put(ctx context.Context, dir model.Obj, f model.FileStreamer, up driver.UpdateProgress) error {
	b, err := io.ReadAll(f)
	if err != nil {
		return err
	}
	d.bodies = append(d.bodies, string(b))
	if d.entered != nil {
		close(d.entered)
		<-d.release
	}
	if d.fail {
		d.fail = false
		return errors.New("synthetic drive outage")
	}
	return os.WriteFile(filepath.Join(d.RootFolderPath, f.GetName()), b, 0600)
}

func setupStagedTest(t *testing.T) (*model.User, *stagedSession, *stagedTestDriver) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	oldDir, oldConf, oldManager := flags.DataDir, conf.Conf, fs.UploadTaskManager
	flags.DataDir = t.TempDir()
	conf.Conf = conf.DefaultConfig(flags.DataDir)
	database, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "test.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	db.Init(database)
	root := t.TempDir()
	op.RegisterDriver(func() driver.Driver { return &stagedTestDriver{} })
	addition, _ := json.Marshal(map[string]string{"root_folder_path": root})
	mount := "/" + t.Name()
	if _, err := op.CreateStorage(context.Background(), model.Storage{Driver: "StagedTest", MountPath: mount, Addition: string(addition)}); err != nil {
		t.Fatal(err)
	}
	storage, _ := op.GetStorageByMountPath(mount)
	user := &model.User{Username: "staged-user", BasePath: mount, Permission: 1 << 3}
	if err := db.CreateUser(user); err != nil {
		t.Fatal(err)
	}
	fs.UploadTaskManager = tache.NewManager[*fs.UploadTask](tache.WithWorks(0))
	staged.Lock()
	staged.loaded = true
	staged.byID = map[string]*stagedSession{}
	staged.Unlock()
	if err := os.MkdirAll(stagedDir(), 0700); err != nil {
		t.Fatal(err)
	}
	s := &stagedSession{ID: "aabbcc", UserID: user.ID, Path: mount + "/file.txt", Shown: "/file.txt", Size: 3, ChunkSize: 3, Have: []byte{1}, Overwrite: true, Created: time.Now(), Updated: time.Now()}
	if err := os.WriteFile(s.partPath(), []byte("abc"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := s.save(); err != nil {
		t.Fatal(err)
	}
	staged.byID[s.ID] = s
	t.Cleanup(func() {
		_ = op.DeleteStorageById(context.Background(), storage.GetStorage().ID)
		staged.Lock()
		staged.loaded = true
		staged.byID = map[string]*stagedSession{}
		staged.Unlock()
		flags.DataDir, conf.Conf, fs.UploadTaskManager = oldDir, oldConf, oldManager
		sqlDB, _ := database.DB()
		_ = sqlDB.Close()
	})
	return user, s, storage.(*stagedTestDriver)
}

func callStaged(t *testing.T, user *model.User, s *stagedSession, handler gin.HandlerFunc, body string) string {
	t.Helper()
	r := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(r)
	req := httptest.NewRequest("POST", "/api/fs/staged?upload_id="+s.ID, bytes.NewBufferString(body))
	req.Header.Set("X-Upload-Id", s.ID)
	req.Header.Set("X-Chunk-Index", "0")
	c.Request = req.WithContext(context.WithValue(req.Context(), conf.UserKey, user))
	handler(c)
	return r.Body.String()
}
func assertStagedCode(t *testing.T, body string, code int) {
	t.Helper()
	var response struct {
		Code int `json:"code"`
	}
	if err := json.Unmarshal([]byte(body), &response); err != nil {
		t.Fatal(err)
	}
	if response.Code != code {
		t.Fatalf("want code %d, got %s", code, body)
	}
}
func TestStagedCompleteRetainsDurableSourceUntilDriveSuccess(t *testing.T) {
	user, s, d := setupStagedTest(t)
	d.fail = true
	assertStagedCode(t, callStaged(t, user, s, TgvioStagedComplete, ""), 200)
	if _, err := os.Stat(filepath.Join(stagedDir(), s.ID+".json")); err != nil {
		t.Fatalf("queued upload lost recovery metadata: %v", err)
	}
	tasks := fs.UploadTaskManager.GetAll()
	if len(tasks) != 1 {
		t.Fatalf("tasks=%d", len(tasks))
	}
	if err := tasks[0].Run(); err == nil || !strings.Contains(err.Error(), "synthetic drive outage") {
		t.Fatalf("first attempt = %v", err)
	}
	if data, err := os.ReadFile(s.partPath()); err != nil || string(data) != "abc" {
		t.Fatalf("failed attempt lost staged bytes: %q %v", data, err)
	}
	if err := tasks[0].Run(); err != nil {
		t.Fatalf("retry failed: %v", err)
	}
	if len(d.bodies) != 2 || d.bodies[1] != "abc" {
		t.Fatalf("retry did not reopen full source: %#v", d.bodies)
	}
	if _, err := os.Stat(s.partPath()); !os.IsNotExist(err) {
		t.Fatalf("successful upload retained source: %v", err)
	}
	if _, err := os.Stat(filepath.Join(stagedDir(), s.ID+".json")); !os.IsNotExist(err) {
		t.Fatalf("successful upload retained recovery metadata: %v", err)
	}
}
func TestStagedCompleteIsIdempotentWhileQueued(t *testing.T) {
	user, s, _ := setupStagedTest(t)
	assertStagedCode(t, callStaged(t, user, s, TgvioStagedComplete, ""), 200)
	assertStagedCode(t, callStaged(t, user, s, TgvioStagedComplete, ""), 200)
	if n := len(fs.UploadTaskManager.GetAll()); n != 1 {
		t.Fatalf("duplicate completion queued %d tasks", n)
	}
}
func TestStagedQueuedUploadRejectsAbortAndChunk(t *testing.T) {
	user, s, _ := setupStagedTest(t)
	assertStagedCode(t, callStaged(t, user, s, TgvioStagedComplete, ""), 200)
	assertStagedCode(t, callStaged(t, user, s, TgvioStagedChunk, "xyz"), 409)
	assertStagedCode(t, callStaged(t, user, s, TgvioStagedAbort, ""), 409)
	if data, err := os.ReadFile(s.partPath()); err != nil || string(data) != "abc" {
		t.Fatalf("queued source changed: %q %v", data, err)
	}
}
func TestStagedListDoesNotHoldGlobalLockWaitingForSession(t *testing.T) {
	user, s, _ := setupStagedTest(t)
	s.mu.Lock()
	done := make(chan struct{})
	go func() { callStaged(t, user, s, TgvioStagedList, ""); close(done) }()
	time.Sleep(25 * time.Millisecond)
	unlocked := staged.TryLock()
	if unlocked {
		staged.Unlock()
	}
	s.mu.Unlock()
	<-done
	if !unlocked {
		t.Fatal("list holds global staged lock while waiting for session; completion can deadlock")
	}
}

func TestStagedRecoveryRequeuesHandedOffSourceOnce(t *testing.T) {
	user, s, d := setupStagedTest(t)
	assertStagedCode(t, callStaged(t, user, s, TgvioStagedComplete, ""), 200)
	// Simulate a process restart: only disk metadata and payload survive.
	fs.UploadTaskManager = tache.NewManager[*fs.UploadTask](tache.WithWorks(0))
	staged.Lock()
	staged.loaded = false
	staged.byID = map[string]*stagedSession{}
	staged.Unlock()
	recoverStaged()
	recoverStaged()
	tasks := fs.UploadTaskManager.GetAll()
	if len(tasks) != 1 {
		t.Fatalf("recovered %d tasks", len(tasks))
	}
	assertStagedCode(t, callStaged(t, user, s, TgvioStagedStatus, ""), 200)
	listed := callStaged(t, user, s, TgvioStagedList, "")
	if !strings.Contains(listed, `"upload_id":"`+s.ID+`"`) || !strings.Contains(listed, `"task":`) {
		t.Fatalf("handed-off upload missing from list: %s", listed)
	}
	if err := tasks[0].Run(); err != nil {
		t.Fatal(err)
	}
	if len(d.bodies) != 1 || d.bodies[0] != "abc" {
		t.Fatalf("recovered source=%#v", d.bodies)
	}
}

func TestStagedRecoveryLeavesUnsubmittedAndIncompleteSessions(t *testing.T) {
	_, s, _ := setupStagedTest(t)
	recoverStaged()
	if n := len(fs.UploadTaskManager.GetAll()); n != 0 {
		t.Fatalf("unsubmitted upload queued %d tasks", n)
	}
	s.HandedOff = true
	s.Have[0] = 0
	recoverStaged()
	if n := len(fs.UploadTaskManager.GetAll()); n != 0 {
		t.Fatalf("incomplete upload queued %d tasks", n)
	}
}

func TestStagedRetryRechecksCurrentUser(t *testing.T) {
	for _, change := range []string{"disabled", "permission", "base", "multi-root"} {
		t.Run(change, func(t *testing.T) {
			user, s, d := setupStagedTest(t)
			d.fail = true
			assertStagedCode(t, callStaged(t, user, s, TgvioStagedComplete, ""), 200)
			task := fs.UploadTaskManager.GetAll()[0]
			if err := task.Run(); err == nil {
				t.Fatal("expected synthetic outage")
			}
			switch change {
			case "disabled":
				user.Disabled = true
			case "permission":
				user.Permission = 0
			case "base":
				user.BasePath = "/different-root"
			case "multi-root":
				user.BasePath = "/different-root\n/another-root"
			}
			if err := db.UpdateUser(user); err != nil {
				t.Fatal(err)
			}
			if err := task.Run(); err == nil {
				t.Fatal("retry ignored current user access")
			}
			if len(d.bodies) != 1 {
				t.Fatalf("revoked user reached drive: %#v", d.bodies)
			}
			if data, err := os.ReadFile(s.partPath()); err != nil || string(data) != "abc" {
				t.Fatalf("revoked upload source lost: %q %v", data, err)
			}
		})
	}
}

func TestStagedRetryHonorsNoOverwrite(t *testing.T) {
	user, s, d := setupStagedTest(t)
	s.Overwrite = false
	d.fail = true
	assertStagedCode(t, callStaged(t, user, s, TgvioStagedComplete, ""), 200)
	task := fs.UploadTaskManager.GetAll()[0]
	if err := task.Run(); err == nil {
		t.Fatal("expected synthetic outage")
	}
	destination := filepath.Join(d.RootFolderPath, "file.txt")
	if err := os.WriteFile(destination, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := task.Run(); err == nil || !strings.Contains(err.Error(), "file exists") {
		t.Fatalf("conflict=%v", err)
	}
	if data, _ := os.ReadFile(destination); string(data) != "keep" {
		t.Fatalf("retry overwrote destination: %q", data)
	}
	if len(d.bodies) != 1 {
		t.Fatalf("conflicting retry reached drive: %#v", d.bodies)
	}
	if _, err := os.Stat(s.partPath()); err != nil {
		t.Fatalf("conflicting retry lost resumable source: %v", err)
	}
}

func TestStagedCanceledAttemptRetainsSourceUntilDriverReturns(t *testing.T) {
	user, s, d := setupStagedTest(t)
	d.entered = make(chan struct{})
	d.release = make(chan struct{})
	assertStagedCode(t, callStaged(t, user, s, TgvioStagedComplete, ""), 200)
	task := fs.UploadTaskManager.GetAll()[0]
	done := make(chan error, 1)
	go func() { done <- task.Run() }()
	select {
	case <-d.entered:
	case <-time.After(2 * time.Second):
		t.Fatal("drive did not start")
	}
	task.SetState(tache.StateCanceled)
	assertStagedCode(t, callStaged(t, user, s, TgvioStagedAbort, ""), 409)
	s.mu.Lock()
	s.Updated = time.Now().Add(-2 * stagedTTL)
	s.mu.Unlock()
	gcStaged(time.Now())
	if _, err := os.Stat(s.partPath()); err != nil {
		t.Fatalf("GC deleted an active canceled source: %v", err)
	}
	close(d.release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestStagedSuccessPersistenceFailureDoesNotRepeatRemoteWrite(t *testing.T) {
	user, s, d := setupStagedTest(t)
	assertStagedCode(t, callStaged(t, user, s, TgvioStagedComplete, ""), 200)
	task := fs.UploadTaskManager.GetAll()[0]
	// A directory at the temporary metadata path makes saving completion fail.
	temp := filepath.Join(stagedDir(), s.ID+".json.tmp")
	if err := os.Mkdir(temp, 0700); err != nil {
		t.Fatal(err)
	}
	if err := task.Run(); err == nil {
		t.Fatal("expected persistence failure")
	}
	if _, err := os.Stat(s.partPath()); err != nil {
		t.Fatalf("failed completion persistence deleted source: %v", err)
	}
	if err := os.Remove(temp); err != nil {
		t.Fatal(err)
	}
	if err := task.Run(); err != nil {
		t.Fatal(err)
	}
	if len(d.bodies) != 1 {
		t.Fatalf("local cleanup retry repeated remote write: %#v", d.bodies)
	}
}

func TestStagedRetryRechecksFolderWriteAllowlist(t *testing.T) {
	user, s, d := setupStagedTest(t)
	d.fail = true
	assertStagedCode(t, callStaged(t, user, s, TgvioStagedComplete, ""), 200)
	task := fs.UploadTaskManager.GetAll()[0]
	if err := task.Run(); err == nil {
		t.Fatal("expected synthetic outage")
	}
	meta := &model.Meta{Path: user.BasePath, WriteUsers: []uint{user.ID + 1}}
	if err := op.CreateMeta(meta); err != nil {
		t.Fatal(err)
	}
	if err := task.Run(); err == nil {
		t.Fatal("retry ignored updated folder write allowlist")
	}
	if len(d.bodies) != 1 {
		t.Fatalf("unauthorized retry reached drive: %#v", d.bodies)
	}
}

func TestStagedRecoveryRetainsSourceWhenAccessChanged(t *testing.T) {
	user, s, _ := setupStagedTest(t)
	assertStagedCode(t, callStaged(t, user, s, TgvioStagedComplete, ""), 200)
	user.Disabled = true
	if err := db.UpdateUser(user); err != nil {
		t.Fatal(err)
	}
	fs.UploadTaskManager = tache.NewManager[*fs.UploadTask](tache.WithWorks(0))
	staged.Lock()
	staged.loaded = false
	staged.byID = map[string]*stagedSession{}
	staged.Unlock()
	recoverStaged()
	if n := len(fs.UploadTaskManager.GetAll()); n != 0 {
		t.Fatalf("disabled user's upload recovered %d tasks", n)
	}
	if _, err := os.Stat(s.partPath()); err != nil {
		t.Fatalf("access change deleted source: %v", err)
	}
	if _, err := os.Stat(filepath.Join(stagedDir(), s.ID+".json")); err != nil {
		t.Fatalf("access change deleted metadata: %v", err)
	}
}
