package handles

import (
	"fmt"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"strings"
	"sync"
	"testing"
	"time"
)

func resetOrganizeRuns(t *testing.T) {
	t.Helper()
	organizeMu.Lock()
	old := organizeRuns
	organizeRuns = map[string]*organizeRun{}
	organizeMu.Unlock()
	t.Cleanup(func() { organizeMu.Lock(); organizeRuns = old; organizeMu.Unlock() })
}

func TestOrganizeFinishReleasesOnlyOwnersIdleBatch(t *testing.T) {
	resetOrganizeRuns(t)
	release, _ := acquireOrganize([]string{"/lib"}, manualOwner(1, "batch"), true)
	user := &model.User{ID: 1}
	response := invokeHandler(t, user, map[string]string{"batch": "batch"}, TgvioRenameFinish)
	if !strings.Contains(response.Body.String(), `"code":409`) {
		t.Fatalf("active writer was released: %s", response.Body.String())
	}
	release()
	invokeHandler(t, &model.User{ID: 2}, map[string]string{"batch": "batch"}, TgvioRenameFinish)
	if unlock, ok := acquireOrganize([]string{"/lib"}, "other", false); ok {
		unlock()
		t.Fatal("another user released the batch")
	}
	response = invokeHandler(t, user, map[string]string{"batch": "batch"}, TgvioRenameFinish)
	if !strings.Contains(response.Body.String(), `"code":200`) {
		t.Fatalf("finish failed: %s", response.Body.String())
	}
	if unlock, ok := acquireOrganize([]string{"/lib"}, "other", false); !ok {
		t.Fatal("finished batch still blocks the next operation")
	} else {
		unlock()
	}
}

func TestOrganizeOnlyOneOverlappingRequestCanRun(t *testing.T) {
	resetOrganizeRuns(t)
	start := make(chan struct{})
	var wg sync.WaitGroup
	releases := make(chan func(), 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			if release, ok := acquireOrganize([]string{"/lib/show/season"}, fmt.Sprint(i), false); ok {
				releases <- release
			}
		}(i)
	}
	close(start)
	wg.Wait()
	close(releases)
	count := 0
	for release := range releases {
		count++
		release()
	}
	if count != 1 {
		t.Fatalf("overlapping writes started together: %d", count)
	}
}

func TestOrganizeLeaseProtectsLongRequestsAndBatchGaps(t *testing.T) {
	resetOrganizeRuns(t)
	release, ok := acquireOrganize([]string{"/lib/show"}, "manual:1:batch", true)
	if !ok {
		t.Fatal("first request rejected")
	}
	organizeMu.Lock()
	organizeRuns["manual:1:batch"].at = time.Now().Add(-2 * manualHold)
	organizeMu.Unlock()
	if unlock, ok := acquireOrganize([]string{"/lib/show/season"}, "automatic", false); ok {
		unlock()
		t.Fatal("active request expired while still writing")
	}
	if unlock, ok := acquireOrganize([]string{"/lib/show"}, "manual:1:batch", true); ok {
		unlock()
		t.Fatal("same batch allowed overlapping HTTP requests")
	}
	release()
	if unlock, ok := acquireOrganize([]string{"/lib"}, "other", false); ok {
		unlock()
		t.Fatal("another run entered between requests of a manual batch")
	}
	// The next request and immediate undo belong to the same user and batch.
	undoRelease, ok := acquireOrganize([]string{"/lib/show"}, "manual:1:batch", false)
	if !ok {
		t.Fatal("owner could not continue its own batch")
	}
	undoRelease()
	if unlock, ok := acquireOrganize([]string{"/lib"}, "other", false); !ok {
		t.Fatal("completed run never released")
	} else {
		unlock()
	}
}

func TestOrganizeIdleLeaseExpiresAndPathsUseBoundaries(t *testing.T) {
	resetOrganizeRuns(t)
	release, _ := acquireOrganize([]string{"/lib"}, "old", true)
	release()
	organizeMu.Lock()
	organizeRuns["old"].at = time.Now().Add(-2 * manualHold)
	organizeMu.Unlock()
	release, ok := acquireOrganize([]string{"/lib/show"}, "new", false)
	if !ok {
		t.Fatal("abandoned idle run did not expire")
	}
	defer release()
	if unlock, ok := acquireOrganize([]string{"/library"}, "unrelated", false); !ok {
		t.Fatal("sibling prefix blocked")
	} else {
		unlock()
	}
	if unlock, ok := acquireOrganize([]string{"/"}, "root", false); ok {
		unlock()
		t.Fatal("root must overlap every descendant")
	}
}
