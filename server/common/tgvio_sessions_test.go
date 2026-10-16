package common

import (
	"testing"
	"time"

	"github.com/OpenListTeam/OpenList/v4/cmd/flags"
)

func TestDescribeAgent(t *testing.T) {
	cases := map[string][2]string{
		"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1": {"iPhone", "Safari"},
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36":                      {"Mac", "Chrome"},
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0":                 {"Windows", "Edge"},
		"Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36":                    {"Android 手机", "Chrome"},
		"curl/8.5": {"未知设备", "其他客户端"},
	}
	for ua, want := range cases {
		if device, browser := DescribeAgent(ua); device != want[0] || browser != want[1] {
			t.Errorf("DescribeAgent(%q) = %s %s, want %v", ua, device, browser, want)
		}
	}
}

func TestDeviceSessions(t *testing.T) {
	flags.DataDir = t.TempDir()
	sessions.loaded, sessions.byID = false, map[string]*DeviceSession{}
	a := NewDeviceSession(7, "ann", "1.2.3.4", "iPhone Safari/1")
	b := NewDeviceSession(7, "ann", "1.2.3.5", "Macintosh Chrome/1")
	if !TouchDeviceSession(a, 7, "1.2.3.4") || TouchDeviceSession(a, 8, "") {
		t.Fatal("a session belongs to its user")
	}
	if n := RevokeUserSessions(7, a); n != 1 || TouchDeviceSession(b, 7, "") || !TouchDeviceSession(a, 7, "") {
		t.Fatal("sign out the others, keep this one")
	}
	sessions.byID[a].LastSeen = time.Now().Add(-100 * 24 * time.Hour)
	if TouchDeviceSession(a, 7, "") {
		t.Fatal("an idle session expires")
	}
}
