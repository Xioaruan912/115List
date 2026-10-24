package _115

import (
	"context"
	"errors"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/tgvio"
	"github.com/go-resty/resty/v2"
	"golang.org/x/time/rate"
)

// One guard for every 115 storage of this process: the drive's WAF judges the
// account and the server address, not a single mount, so five mounts each
// allowed their own rate could still add up to a burst it answers with 405.
//
//   - A shared token bucket paces every 115 API call (not the media bytes).
//   - A 405 opens a breaker: calls slow to one per few seconds for a cooldown
//     that doubles on each further 405 (30 s up to 15 min); the level resets
//     once the breaker has stayed closed for a quiet period.
//   - A connection that fails before the request was sent (dial error, TLS
//     handshake timeout) is retried; nothing was sent, so even a POST is safe.
//     The drive's edge drops a share of new TLS handshakes from this host.
type apiGuard struct {
	normal *rate.Limiter
	slow   *rate.Limiter

	mu        sync.Mutex
	level     int
	openUntil time.Time
	last405   time.Time
	now       func() time.Time
}

const (
	breakerBase  = 30 * time.Second
	breakerMax   = 15 * time.Minute
	breakerQuiet = 10 * time.Minute
)

func envFloat(name string, fallback float64) float64 {
	if value, err := strconv.ParseFloat(os.Getenv(name), 64); err == nil && value > 0 {
		return value
	}
	return fallback
}

func newAPIGuard(perSecond float64, burst int) *apiGuard {
	return &apiGuard{
		normal: rate.NewLimiter(rate.Limit(perSecond), burst),
		slow:   rate.NewLimiter(rate.Every(5*time.Second), 1),
		now:    time.Now,
	}
}

// OPENLIST_115_API_RATE (formerly TGVIO_115_API_RATE) overrides the shared pace (calls per second, default 4).
var guard = newAPIGuard(envFloat("OPENLIST_115_API_RATE", envFloat("TGVIO_115_API_RATE", 4)), 8)

func init() {
	tgvio.Provide("115_breaker", func() any { return guard.state() })
	tgvio.DriveBusy = guard.open // background work (thumbnails) waits while the breaker is open
}

func (g *apiGuard) open() bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.now()
	if g.level > 0 && now.Sub(g.openUntil) > breakerQuiet { // quiet since the breaker closed
		g.level = 0
	}
	return now.Before(g.openUntil)
}

func (g *apiGuard) wait(ctx context.Context) error {
	if g.open() {
		tgvio.Inc("115_calls_slowed")
		return g.slow.Wait(ctx)
	}
	return g.normal.Wait(ctx)
}

func (g *apiGuard) record405() {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.now()
	if g.level < 6 {
		g.level++
	}
	cooldown := breakerBase << (g.level - 1)
	if cooldown > breakerMax {
		cooldown = breakerMax
	}
	g.openUntil = now.Add(cooldown)
	g.last405 = now
}

func (g *apiGuard) state() map[string]any {
	open := g.open()
	g.mu.Lock()
	defer g.mu.Unlock()
	state := map[string]any{"open": open, "level": g.level}
	if open {
		state["open_until"] = g.openUntil.UTC().Format(time.RFC3339)
	}
	if !g.last405.IsZero() {
		state["last_405"] = g.last405.UTC().Format(time.RFC3339)
	}
	return state
}

// callKind names a 115 API call for the counters without its query string.
func callKind(rawURL string) string {
	path := rawURL
	if i := strings.Index(path, "://"); i >= 0 {
		path = path[i+3:]
	}
	if i := strings.IndexAny(path, "?#"); i >= 0 {
		path = path[:i]
	}
	if i := strings.Index(path, "/"); i >= 0 {
		host, rest := path[:i], strings.Trim(path[i:], "/")
		return strings.SplitN(host, ".", 2)[0] + "/" + rest
	}
	return path
}

// isPreSendFailure: the connection failed before the request went out, so a
// retry cannot repeat an action the drive already took.
func isPreSendFailure(err error) bool {
	if err == nil {
		return false
	}
	var opErr *net.OpError
	if errors.As(err, &opErr) && opErr.Op == "dial" {
		return true
	}
	return strings.Contains(err.Error(), "TLS handshake timeout")
}

func (g *apiGuard) install(client *resty.Client) {
	// Runs before every attempt, retries included.
	client.OnBeforeRequest(func(_ *resty.Client, r *resty.Request) error {
		return g.wait(r.Context())
	})
	client.OnAfterResponse(func(_ *resty.Client, r *resty.Response) error {
		tgvio.Inc("115_calls")
		tgvio.Inc("115_calls:" + callKind(r.Request.URL))
		if r.StatusCode() == http.StatusMethodNotAllowed {
			tgvio.Inc("115_405")
			tgvio.Inc("115_405:" + callKind(r.Request.URL))
			g.record405()
		}
		return nil
	})
	client.OnError(func(r *resty.Request, err error) {
		tgvio.Inc("115_errors")
		if isPreSendFailure(err) {
			tgvio.Inc("115_connect_failures")
		}
	})
	client.SetRetryCount(3).
		SetRetryWaitTime(time.Second).
		SetRetryMaxWaitTime(4 * time.Second).
		AddRetryCondition(func(_ *resty.Response, err error) bool {
			if isPreSendFailure(err) {
				tgvio.Inc("115_connect_retries")
				return true
			}
			return false
		})
}

var errNoRecycleIDs = errors.New("no recycle bin entries given")
