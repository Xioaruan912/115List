package handles

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	stdpath "path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/OpenListTeam/OpenList/v4/cmd/flags"
	"github.com/OpenListTeam/OpenList/v4/internal/tgvio"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
)

// TGVIO: Trakt — the library reports what is being watched there. The app is a
// public Trakt application (PKCE, no client secret): the person approves it in
// the browser and the code comes back to /api/tgvio/trakt/callback.

const traktAPI = "https://api.trakt.tv"

// traktRedirect must be the redirect URI registered in the Trakt application.
var traktRedirect = "https://file.722225.xyz/api/tgvio/trakt/callback"

type traktConfig struct {
	ClientID     string `json:"client_id"`
	AccessToken  string `json:"access_token,omitempty"`
	RefreshToken string `json:"refresh_token,omitempty"`
	ExpiresAt    int64  `json:"expires_at,omitempty"`
	Scope        string `json:"scope,omitempty"`
	At           int64  `json:"at,omitempty"`
}

type traktStore struct {
	path string
	mu   sync.Mutex
	cfg  traktConfig
}

var (
	traktOnce sync.Once
	traktInst *traktStore
)

func trakt() *traktStore {
	traktOnce.Do(func() {
		traktInst = &traktStore{path: filepath.Join(flags.DataDir, "tgvio", "trakt.json")}
		if raw, err := os.ReadFile(traktInst.path); err == nil {
			_ = json.Unmarshal(raw, &traktInst.cfg)
		}
	})
	return traktInst
}

func (s *traktStore) saveLocked() {
	if raw, err := json.Marshal(s.cfg); err == nil {
		_ = os.WriteFile(s.path, raw, 0o600)
	}
}

// GET /api/admin/tgvio/trakt
func TgvioTraktGet(c *gin.Context) {
	s := trakt()
	s.mu.Lock()
	cfg := s.cfg
	s.mu.Unlock()
	common.SuccessResp(c, gin.H{
		"client_id":  cfg.ClientID,
		"redirect":   traktRedirect,
		"connected":  cfg.AccessToken != "",
		"expires_at": cfg.ExpiresAt,
	})
}

type traktSetReq struct {
	ClientID string `json:"client_id"`
}

// POST /api/admin/tgvio/trakt {client_id}
func TgvioTraktSet(c *gin.Context) {
	var req traktSetReq
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.ClientID) == "" {
		common.ErrorStrResp(c, "client_id is required", 400)
		return
	}
	s := trakt()
	s.mu.Lock()
	s.cfg.ClientID = strings.TrimSpace(req.ClientID)
	s.saveLocked()
	s.mu.Unlock()
	common.SuccessResp(c, gin.H{"client_id": req.ClientID})
}

type traktPending struct {
	Verifier string `json:"verifier"`
	At       int64  `json:"at"`
}

var (
	traktStatesMu    sync.Mutex
	traktStates      = map[string]traktPending{}
	traktStatesReady bool
)

// The pending authorizations outlive a restart (a deploy in the middle of a
// sign-in would otherwise lose the verifier the token exchange needs).
func traktStatesFile() string { return filepath.Join(flags.DataDir, "tgvio", "trakt-pending.json") }

func traktStatesLoadLocked() {
	if traktStatesReady {
		return
	}
	traktStatesReady = true
	if raw, err := os.ReadFile(traktStatesFile()); err == nil {
		_ = json.Unmarshal(raw, &traktStates)
	}
}

func traktStatesSaveLocked() {
	if raw, err := json.Marshal(traktStates); err == nil {
		_ = os.WriteFile(traktStatesFile(), raw, 0o600)
	}
}

// POST /api/admin/tgvio/trakt/connect — the browser goes to the returned URL.
func TgvioTraktConnect(c *gin.Context) {
	s := trakt()
	s.mu.Lock()
	id := s.cfg.ClientID
	s.mu.Unlock()
	if id == "" {
		common.ErrorStrResp(c, "先填 Client ID", 400)
		return
	}
	verifier := randomURL(48)
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	state := randomURL(16)
	traktStatesMu.Lock()
	traktStatesLoadLocked()
	now := time.Now().Unix()
	for k, v := range traktStates {
		if now-v.At > 15*60 {
			delete(traktStates, k)
		}
	}
	traktStates[state] = traktPending{Verifier: verifier, At: now}
	traktStatesSaveLocked()
	traktStatesMu.Unlock()
	q := url.Values{
		"response_type":         {"code"},
		"client_id":             {id},
		"redirect_uri":          {traktRedirect},
		"state":                 {state},
		"code_challenge":        {challenge},
		"code_challenge_method": {"S256"},
	}
	common.SuccessResp(c, gin.H{"url": "https://trakt.tv/oauth/authorize?" + q.Encode()})
}

// GET /api/tgvio/trakt/callback?code&state — Trakt sends the person back here.
func TgvioTraktCallback(c *gin.Context) {
	code, state := c.Query("code"), c.Query("state")
	errMsg := ""
	if code == "" {
		errMsg = c.Query("error_description")
		if errMsg == "" {
			errMsg = "Trakt 没有返回授权码"
		}
	}
	var pend traktPending
	if errMsg == "" {
		traktStatesMu.Lock()
		traktStatesLoadLocked()
		p, ok := traktStates[state]
		if ok {
			delete(traktStates, state)
			traktStatesSaveLocked()
		}
		traktStatesMu.Unlock()
		if !ok || time.Now().Unix()-p.At > 15*60 {
			errMsg = "授权已过期，请回到设置页重新连接"
		}
		pend = p
	}
	if errMsg == "" {
		s := trakt()
		s.mu.Lock()
		id := s.cfg.ClientID
		s.mu.Unlock()
		tok, err := traktToken(context.Background(), map[string]string{
			"code":          code,
			"client_id":     id,
			"redirect_uri":  traktRedirect,
			"grant_type":    "authorization_code",
			"code_verifier": pend.Verifier,
		})
		if err != nil {
			errMsg = err.Error()
		} else {
			s.mu.Lock()
			s.cfg.AccessToken = tok.AccessToken
			s.cfg.RefreshToken = tok.RefreshToken
			s.cfg.ExpiresAt = time.Now().Unix() + int64(tok.ExpiresIn)
			s.cfg.Scope = tok.Scope
			s.cfg.At = time.Now().Unix()
			s.saveLocked()
			s.mu.Unlock()
		}
	}
	title, body := "Trakt 已连接", "可以关闭这个页面，回到设置里查看。"
	if errMsg != "" {
		title, body = "Trakt 连接失败", errMsg
	}
	c.Header("Content-Type", "text/html; charset=utf-8")
	_, _ = c.Writer.WriteString("<!doctype html><meta charset=utf-8><title>" + title + "</title>" +
		"<body style=\"font-family:system-ui;padding:40px;max-width:40em;margin:auto\"><h2>" + title + "</h2><p>" +
		htmlEscape(body) + "</p><p><a href=\"/@manage/trakt\">返回设置</a></p></body>")
}

func htmlEscape(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&quot;")
	return r.Replace(s)
}

func randomURL(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

type traktTokenOut struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	Scope        string `json:"scope"`
}

func traktToken(ctx context.Context, body map[string]string) (*traktTokenOut, error) {
	raw, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, traktAPI+"/oauth/token", strings.NewReader(string(raw)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "OpenList-TGVIO/1.0")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Trakt: %s", strings.TrimSpace(string(data)))
	}
	var out traktTokenOut
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// POST /api/admin/tgvio/trakt/disconnect
func TgvioTraktDisconnect(c *gin.Context) {
	s := trakt()
	s.mu.Lock()
	s.cfg.AccessToken, s.cfg.RefreshToken, s.cfg.ExpiresAt, s.cfg.Scope = "", "", 0, ""
	s.saveLocked()
	s.mu.Unlock()
	common.SuccessResp(c)
}

// traktTokenNow: the access token, refreshed when it is close to expiring.
func traktTokenNow(ctx context.Context) (string, error) {
	s := trakt()
	s.mu.Lock()
	id, at, exp, rt := s.cfg.ClientID, s.cfg.AccessToken, s.cfg.ExpiresAt, s.cfg.RefreshToken
	s.mu.Unlock()
	if id == "" || at == "" {
		return "", fmt.Errorf("Trakt 未连接")
	}
	if exp > 0 && time.Now().Unix() > exp-3600 && rt != "" {
		tok, err := traktToken(ctx, map[string]string{
			"refresh_token": rt,
			"client_id":     id,
			"redirect_uri":  traktRedirect,
			"grant_type":    "refresh_token",
		})
		if err != nil {
			return "", err
		}
		s.mu.Lock()
		s.cfg.AccessToken = tok.AccessToken
		s.cfg.RefreshToken = tok.RefreshToken
		s.cfg.ExpiresAt = time.Now().Unix() + int64(tok.ExpiresIn)
		s.saveLocked()
		id = s.cfg.ClientID
		at = tok.AccessToken
		s.mu.Unlock()
	}
	return at + "\x00" + id, nil
}

// traktCall: POST a JSON body with the stored token (start/stop, sync…).
func traktCall(ctx context.Context, path string, body any) error {
	tok, err := traktTokenNow(ctx)
	if err != nil {
		return err
	}
	parts := strings.SplitN(tok, "\x00", 2)
	raw, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, traktAPI+path, strings.NewReader(string(raw)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("trakt-api-version", "2")
	req.Header.Set("trakt-api-key", parts[1])
	req.Header.Set("Authorization", "Bearer "+parts[0])
	req.Header.Set("User-Agent", "OpenList-TGVIO/1.0")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<10))
		return fmt.Errorf("Trakt %s: %s", path, strings.TrimSpace(string(data)))
	}
	return nil
}

// traktIdentity: what a playing file is on Trakt (a film, or a series' episode).
func traktIdentity(ctx context.Context, path string) (movie int, series, season, episode int) {
	dir, name := stdpath.Dir(path), stdpath.Base(path)
	if found, _ := posters().Lookup(dir, []string{name}); found[name] != nil {
		p := found[name]
		if !p.None && p.Kind == "movie" {
			return p.ID, 0, 0, 0
		}
	}
	up := stdpath.Dir(dir)
	if up == "/" || up == "." {
		return 0, 0, 0, 0
	}
	if found, _ := posters().Lookup(up, []string{stdpath.Base(dir)}); found[stdpath.Base(dir)] != nil {
		fp := found[stdpath.Base(dir)]
		if fp.None {
			return 0, 0, 0, 0
		}
		if fp.Kind == "movie" {
			return fp.ID, 0, 0, 0
		}
		if fp.Kind == "tv" {
			s, ep := tgvio.ParseEpisode(name)
			if s == 0 {
				s = fp.Season
			}
			if ep == 0 {
				return 0, 0, 0, 0
			}
			return 0, fp.ID, s, ep
		}
	}
	return 0, 0, 0, 0
}

var (
	traktWatchMu sync.Mutex
	traktStarted = map[string]int64{} // path -> started at
)

// scrobbleProgress reports a play to Trakt: start once, stop when it is done.
func scrobbleProgress(ctx context.Context, path string, entry tgvio.WatchEntry) {
	s := trakt()
	s.mu.Lock()
	connected := s.cfg.AccessToken != ""
	s.mu.Unlock()
	if !connected || entry.Duration <= 0 {
		return
	}
	pct := entry.Time / entry.Duration
	if pct < 0 || pct > 1 {
		return
	}
	movie, series, season, episode := traktIdentity(ctx, path)
	if movie == 0 && (series == 0 || episode == 0) {
		return
	}
	body := map[string]any{"progress": pct * 100} // Trakt takes a percentage
	if movie > 0 {
		body["movie"] = map[string]any{"ids": map[string]int{"tmdb": movie}}
	} else {
		body["episode"] = map[string]any{"season": season, "number": episode, "ids": map[string]int{"tmdb": series}}
	}
	traktWatchMu.Lock()
	_, started := traktStarted[path]
	done := entry.Done || pct >= 0.8
	traktWatchMu.Unlock()
	switch {
	case !started && !done:
		if err := traktCall(ctx, "/scrobble/start", body); err == nil {
			traktWatchMu.Lock()
			traktStarted[path] = time.Now().Unix()
			traktWatchMu.Unlock()
		}
	case done && started:
		if err := traktCall(ctx, "/scrobble/stop", body); err == nil {
			traktWatchMu.Lock()
			delete(traktStarted, path)
			traktWatchMu.Unlock()
		}
	}
}

// traktOnProgress: called after progress is merged, for what was just sent.
func traktOnProgress(ctx context.Context, items map[string]tgvio.WatchEntry) {
	now := time.Now().UnixMilli()
	for path, entry := range items {
		if now-entry.At > 5*60*1000 {
			continue // old entries re-sent by a new device
		}
		scrobbleProgress(ctx, path, entry)
	}
}

// autoRefreshTraktToken keeps the token fresh in the background.
var lastTraktRefresh time.Time

func autoRefreshTraktToken() {
	if time.Since(lastTraktRefresh) < time.Hour {
		return
	}
	lastTraktRefresh = time.Now()
	s := trakt()
	s.mu.Lock()
	rt := s.cfg.RefreshToken
	s.mu.Unlock()
	if rt == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if _, err := traktTokenNow(ctx); err != nil {
		log.Warnf("tgvio trakt: %v", err)
	}
}
