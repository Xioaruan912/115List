package handles

import (
	"testing"
	"time"
)

func TestGiveUpDue(t *testing.T) {
	old := autoGiveUp
	defer func() { autoGiveUp = old }()
	autoGiveUp = 10 * time.Minute
	start := time.Now()
	if giveUpDue(start, start.Add(9*time.Minute)) {
		t.Fatal("gave up before the window")
	}
	if !giveUpDue(start, start.Add(10*time.Minute+time.Second)) {
		t.Fatal("did not give up after the window")
	}
	autoGiveUp = 0
	if giveUpDue(start, start.Add(99*time.Hour)) {
		t.Fatal("0 should wait forever")
	}
}
