package _115

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/tgvio"
	"github.com/go-resty/resty/v2"
)

func TestBreakerEscalatesAndResetsAfterQuiet(t *testing.T) {
	now := time.Unix(1_000_000, 0)
	g := newAPIGuard(100, 10)
	g.now = func() time.Time { return now }
	if g.open() {
		t.Fatal("a new guard is closed")
	}
	g.record405()
	if !g.open() || g.openUntil.Sub(now) != 30*time.Second {
		t.Fatalf("first 405 opens for 30s, got %v", g.openUntil.Sub(now))
	}
	g.record405()
	if g.openUntil.Sub(now) != time.Minute {
		t.Fatalf("second 405 doubles the cooldown, got %v", g.openUntil.Sub(now))
	}
	for i := 0; i < 10; i++ {
		g.record405()
	}
	if g.openUntil.Sub(now) != breakerMax {
		t.Fatalf("cooldown is capped, got %v", g.openUntil.Sub(now))
	}
	now = now.Add(breakerMax + time.Second)
	if g.open() || g.level == 0 {
		t.Fatal("closed after the cooldown, but the level is kept until a quiet period")
	}
	now = now.Add(breakerQuiet)
	g.open()
	if g.level != 0 {
		t.Fatal("level resets after a quiet period")
	}
}

func TestCallKindDropsHostSuffixAndQuery(t *testing.T) {
	cases := map[string]string{
		"https://webapi.115.com/files?cid=1&offset=0":   "webapi/files",
		"https://proapi.115.com/android/2.0/ufile/down": "proapi/android/2.0/ufile/down",
	}
	for raw, want := range cases {
		if got := callKind(raw); got != want {
			t.Errorf("callKind(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestOnlyPreSendFailuresAreRetried(t *testing.T) {
	if !isPreSendFailure(&net.OpError{Op: "dial", Err: errors.New("refused")}) {
		t.Error("a dial error happens before sending")
	}
	if !isPreSendFailure(errors.New("net/http: TLS handshake timeout")) {
		t.Error("a handshake timeout happens before sending")
	}
	if isPreSendFailure(&net.OpError{Op: "read", Err: errors.New("reset")}) || isPreSendFailure(nil) {
		t.Error("a read error may follow a sent request and must not be retried")
	}
}

func TestA405OpensTheBreakerAndIsCounted(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusMethodNotAllowed)
	}))
	defer server.Close()
	g := newAPIGuard(1000, 10)
	client := resty.New()
	g.install(client)
	before := tgvio.Counters()["115_405"]
	if _, err := client.R().SetContext(context.Background()).Get(server.URL + "/files?x=1"); err != nil {
		t.Fatal(err)
	}
	if tgvio.Counters()["115_405"] != before+1 {
		t.Error("the 405 is counted")
	}
	if !g.open() {
		t.Error("the 405 opens the breaker")
	}
}

func TestAConnectFailureIsRetried(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := listener.Addr().String()
	listener.Close() // nothing listens: every dial is refused
	g := newAPIGuard(1000, 10)
	client := resty.New().SetTimeout(5 * time.Second)
	g.install(client)
	client.SetRetryWaitTime(time.Millisecond).SetRetryMaxWaitTime(time.Millisecond)
	before := tgvio.Counters()["115_connect_retries"]
	if _, err := client.R().Post("http://" + addr + "/delete"); err == nil {
		t.Fatal("a refused connection still fails after its retries")
	}
	if got := tgvio.Counters()["115_connect_retries"] - before; got != 4 {
		t.Errorf("the refused POST is tried again three times (condition seen 4 times), got %d", got)
	}
}

func TestRecycleCleanNeverEmptiesTheWholeBin(t *testing.T) {
	d := &Pan115{} // no client: an attempt to call the drive would panic
	if err := d.RecycleClean(context.Background(), nil); err != errNoRecycleIDs {
		t.Fatalf("an empty id list is refused before any drive call, got %v", err)
	}
}
