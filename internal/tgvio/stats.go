// Package tgvio holds the small additions TGVIO needs from OpenList: process-wide
// counters and state a monitoring endpoint can read. It imports nothing from the
// rest of OpenList, so drivers and handlers can both use it without cycles.
package tgvio

import (
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

var (
	startedAt = time.Now()
	counters  sync.Map // name -> *atomic.Int64
	providers sync.Map // name -> func() any
)

// Inc adds one to a named counter.
func Inc(name string) { Add(name, 1) }

// Add adds n to a named counter.
func Add(name string, n int64) {
	value, _ := counters.LoadOrStore(name, new(atomic.Int64))
	value.(*atomic.Int64).Add(n)
}

// Counters returns every counter, by name.
func Counters() map[string]int64 {
	out := map[string]int64{}
	counters.Range(func(key, value any) bool {
		out[key.(string)] = value.(*atomic.Int64).Load()
		return true
	})
	return out
}

// Provide registers a named state reader, e.g. a circuit breaker's level.
func Provide(name string, read func() any) { providers.Store(name, read) }

// State reads every registered provider, by name.
func State() map[string]any {
	out := map[string]any{}
	var names []string
	providers.Range(func(key, _ any) bool {
		names = append(names, key.(string))
		return true
	})
	sort.Strings(names)
	for _, name := range names {
		read, _ := providers.Load(name)
		out[name] = read.(func() any)()
	}
	return out
}

// StartedAt is when this process started; a restart (or a crash) resets it.
func StartedAt() time.Time { return startedAt }

// RecycleItem is one entry of a drive's recycle bin.
type RecycleItem struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Size      int64  `json:"size"`
	Parent    string `json:"parent"`
	DeletedAt int64  `json:"deleted_at"`
}

// DriveFolder is one folder of a drive, for choosing what to mount.
type DriveFolder struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
