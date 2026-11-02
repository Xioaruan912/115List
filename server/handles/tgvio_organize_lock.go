package handles

import (
	"fmt"
	stdpath "path"
	"strings"
	"sync"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
)

type organizeRun struct {
	paths  []string
	active bool
	at     time.Time
}

var (
	organizeMu   sync.Mutex
	organizeRuns = map[string]*organizeRun{}
	organizeID   uint64
)

const manualHold = 90 * time.Second

func overlaps(a, b string) bool {
	return a == "/" || b == "/" || a == b || strings.HasPrefix(a, b+"/") || strings.HasPrefix(b, a+"/")
}

func manualOwner(user uint, batch string) string {
	if batch == "" {
		return ""
	}
	return fmt.Sprintf("manual:%d:%s", user, batch)
}

// TgvioRenameFinish drops the idle lease after the browser's last batch request.
func TgvioRenameFinish(c *gin.Context) {
	var req struct {
		Batch string `json:"batch"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Batch == "" {
		common.ErrorStrResp(c, "give the run's id", 400)
		return
	}
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	owner := manualOwner(user.ID, req.Batch)
	organizeMu.Lock()
	run := organizeRuns[owner]
	busy := run != nil && run.active
	if !busy {
		delete(organizeRuns, owner)
	}
	organizeMu.Unlock()
	if busy {
		common.ErrorStrResp(c, "这个批次还在整理，等它做完再试", 409)
		return
	}
	common.SuccessResp(c)
}

// Check and claim together. Active HTTP requests never expire; a manual batch
// keeps its claim between requests until it continues, is undone, or goes idle.
func acquireOrganize(paths []string, owner string, hold bool) (func(), bool) {
	organizeMu.Lock()
	defer organizeMu.Unlock()
	now := time.Now()
	for id, run := range organizeRuns {
		if !run.active && now.Sub(run.at) > manualHold {
			delete(organizeRuns, id)
		}
	}
	if owner == "" {
		organizeID++
		owner = fmt.Sprintf("request:%d", organizeID)
	}
	clean := make([]string, 0, len(paths))
	for _, p := range paths {
		clean = append(clean, stdpath.Clean("/"+p))
	}
	for id, run := range organizeRuns {
		if id == owner {
			if run.active {
				return nil, false
			}
			continue
		}
		for _, held := range run.paths {
			for _, requested := range clean {
				if overlaps(held, requested) {
					return nil, false
				}
			}
		}
	}
	run := organizeRuns[owner]
	if run == nil {
		run = &organizeRun{}
		organizeRuns[owner] = run
	}
	for _, p := range clean {
		found := false
		for _, held := range run.paths {
			if p == held {
				found = true
				break
			}
		}
		if !found {
			run.paths = append(run.paths, p)
		}
	}
	run.active, run.at = true, now
	var once sync.Once
	return func() {
		once.Do(func() {
			organizeMu.Lock()
			defer organizeMu.Unlock()
			if hold {
				run.active, run.at = false, time.Now()
			} else {
				delete(organizeRuns, owner)
			}
		})
	}, true
}
