package common

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"sync"
	"time"

	"github.com/OpenListTeam/OpenList/v4/cmd/flags"
)

// TGVIO: signed-in devices.
//
// Upstream keeps the valid tokens in memory, so every restart (deploys, the
// nightly backup) signs every device out, and tokens die after 48 hours. Here
// each sign-in is a device session stored in <data>/tgvio/sessions.json; the
// token carries its id. A device stays signed in while it is used and expires
// after a configurable number of idle days. People see their devices and sign
// any of them out; admins see everyone's.

type DeviceSession struct {
	ID       string    `json:"id"`
	UserID   uint      `json:"user_id"`
	Username string    `json:"username"`
	Device   string    `json:"device"` // e.g. "iPhone", "Mac"
	Browser  string    `json:"browser"`
	IP       string    `json:"ip"`
	Created  time.Time `json:"created"`
	LastSeen time.Time `json:"last_seen"`
}

type SessionConfig struct {
	IdleDays int `json:"idle_days"` // a device unused this long must sign in again
}

var sessions = struct {
	sync.Mutex
	loaded bool
	byID   map[string]*DeviceSession
	cfg    SessionConfig
	timer  *time.Timer
}{byID: map[string]*DeviceSession{}}

func sessionFile() string { return filepath.Join(flags.DataDir, "tgvio", "sessions.json") }

type sessionStore struct {
	Config   SessionConfig    `json:"config"`
	Sessions []*DeviceSession `json:"sessions"`
}

func loadSessionsLocked() {
	if sessions.loaded {
		return
	}
	sessions.loaded = true
	sessions.cfg = SessionConfig{IdleDays: 90}
	raw, err := os.ReadFile(sessionFile())
	if err != nil {
		return
	}
	var store sessionStore
	if json.Unmarshal(raw, &store) != nil {
		return
	}
	if store.Config.IdleDays > 0 {
		sessions.cfg = store.Config
	}
	for _, s := range store.Sessions {
		sessions.byID[s.ID] = s
	}
}

// writeSessionsLocked puts the store on disk now: sign-ins and sign-outs must
// survive a restart that comes a moment later.
func writeSessionsLocked() {
	store := sessionStore{Config: sessions.cfg}
	for _, s := range sessions.byID {
		copy := *s
		store.Sessions = append(store.Sessions, &copy)
	}
	raw, err := json.Marshal(store)
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(sessionFile()), 0o700)
	tmp := sessionFile() + ".tmp"
	if os.WriteFile(tmp, raw, 0o600) == nil {
		_ = os.Rename(tmp, sessionFile())
	}
}

// saveSessionsLocked writes soon; for "last seen" updates, which may be lost.
func saveSessionsLocked() {
	if sessions.timer != nil {
		sessions.timer.Stop()
	}
	sessions.timer = time.AfterFunc(2*time.Second, func() {
		sessions.Lock()
		defer sessions.Unlock()
		writeSessionsLocked()
	})
}

func idleLimit() time.Duration { return time.Duration(sessions.cfg.IdleDays) * 24 * time.Hour }

var (
	reDevice = []struct {
		re   *regexp.Regexp
		name string
	}{
		{regexp.MustCompile(`iPad`), "iPad"}, {regexp.MustCompile(`iPhone`), "iPhone"}, {regexp.MustCompile(`Android.*Mobile`), "Android 手机"},
		{regexp.MustCompile(`Android`), "Android 平板"}, {regexp.MustCompile(`Macintosh|Mac OS X`), "Mac"}, {regexp.MustCompile(`Windows`), "Windows"},
		{regexp.MustCompile(`CrOS`), "Chromebook"}, {regexp.MustCompile(`Linux`), "Linux"},
	}
	reBrowser = []struct {
		re   *regexp.Regexp
		name string
	}{
		{regexp.MustCompile(`Edg/`), "Edge"}, {regexp.MustCompile(`OPR/|Opera`), "Opera"}, {regexp.MustCompile(`Firefox/|FxiOS`), "Firefox"},
		{regexp.MustCompile(`CriOS|Chrome/`), "Chrome"}, {regexp.MustCompile(`MicroMessenger`), "微信"}, {regexp.MustCompile(`Safari/`), "Safari"},
	}
)

// DescribeAgent turns a User-Agent into a device and a browser people recognise.
func DescribeAgent(ua string) (device, browser string) {
	device, browser = "未知设备", "其他客户端"
	for _, d := range reDevice {
		if d.re.MatchString(ua) {
			device = d.name
			break
		}
	}
	for _, b := range reBrowser {
		if b.re.MatchString(ua) {
			browser = b.name
			break
		}
	}
	// iPadOS asks for desktop sites and says Macintosh; touch support gives it away
	// only in the page, so a Mac here may be an iPad. That is fine for a label.
	return device, browser
}

// NewDeviceSession records a sign-in and returns its id for the token.
func NewDeviceSession(userID uint, username, ip, ua string) string {
	raw := make([]byte, 12)
	_, _ = rand.Read(raw)
	id := hex.EncodeToString(raw)
	device, browser := DescribeAgent(ua)
	now := time.Now()
	sessions.Lock()
	defer sessions.Unlock()
	loadSessionsLocked()
	sessions.byID[id] = &DeviceSession{ID: id, UserID: userID, Username: username, Device: device, Browser: browser, IP: ip, Created: now, LastSeen: now}
	writeSessionsLocked()
	return id
}

// TouchDeviceSession checks a session and marks it used; false means sign in again.
func TouchDeviceSession(id string, userID uint, ip string) bool {
	sessions.Lock()
	defer sessions.Unlock()
	loadSessionsLocked()
	s, ok := sessions.byID[id]
	if !ok || s.UserID != userID {
		return false
	}
	now := time.Now()
	if now.Sub(s.LastSeen) > idleLimit() {
		delete(sessions.byID, id)
		saveSessionsLocked()
		return false
	}
	// Write at most every few minutes: this runs on every request.
	if now.Sub(s.LastSeen) > 5*time.Minute || (ip != "" && ip != s.IP) {
		s.LastSeen = now
		if ip != "" {
			s.IP = ip
		}
		saveSessionsLocked()
	}
	return true
}

// RevokeDeviceSession signs one device out.
func RevokeDeviceSession(id string) bool {
	sessions.Lock()
	defer sessions.Unlock()
	loadSessionsLocked()
	_, ok := sessions.byID[id]
	delete(sessions.byID, id)
	writeSessionsLocked()
	return ok
}

// RevokeUserSessions signs a user out everywhere except one session (or nowhere spared with "").
func RevokeUserSessions(userID uint, except string) int {
	sessions.Lock()
	defer sessions.Unlock()
	loadSessionsLocked()
	n := 0
	for id, s := range sessions.byID {
		if s.UserID == userID && id != except {
			delete(sessions.byID, id)
			n++
		}
	}
	writeSessionsLocked()
	return n
}

// DeviceSessions lists sessions, newest use first; userID 0 lists everyone's.
func DeviceSessions(userID uint) []DeviceSession {
	sessions.Lock()
	defer sessions.Unlock()
	loadSessionsLocked()
	out := []DeviceSession{}
	limit := idleLimit()
	for id, s := range sessions.byID {
		if time.Since(s.LastSeen) > limit {
			delete(sessions.byID, id)
			continue
		}
		if userID == 0 || s.UserID == userID {
			out = append(out, *s)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].LastSeen.After(out[j].LastSeen) })
	return out
}

func DeviceSessionOf(id string) (DeviceSession, bool) {
	sessions.Lock()
	defer sessions.Unlock()
	loadSessionsLocked()
	s, ok := sessions.byID[id]
	if !ok {
		return DeviceSession{}, false
	}
	return *s, true
}

func GetSessionConfig() SessionConfig {
	sessions.Lock()
	defer sessions.Unlock()
	loadSessionsLocked()
	return sessions.cfg
}

func SetSessionConfig(cfg SessionConfig) {
	if cfg.IdleDays < 1 {
		cfg.IdleDays = 1
	}
	if cfg.IdleDays > 3650 {
		cfg.IdleDays = 3650
	}
	sessions.Lock()
	defer sessions.Unlock()
	loadSessionsLocked()
	sessions.cfg = cfg
	writeSessionsLocked()
}
