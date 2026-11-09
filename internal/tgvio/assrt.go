package tgvio

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// Subtitles from 射手网 (assrt.net): search by a video's file name or a title,
// list a subtitle's files, download one. The free API allows 20 requests a
// minute per token and address; calls queue behind a limiter well under that.
// The token lives in <data>/tgvio/assrt_token (0600) or OPENLIST_ASSRT_TOKEN.

// SubtitleResult is one subtitle found on assrt.
type SubtitleResult struct {
	ID       int     `json:"id"`
	Name     string  `json:"name"`
	Video    string  `json:"video,omitempty"`
	Lang     string  `json:"lang,omitempty"`
	Type     string  `json:"type,omitempty"`
	Score    float64 `json:"score,omitempty"`
	Uploaded string  `json:"uploaded,omitempty"`
}

// SubtitleFile is one downloadable file of a subtitle.
type SubtitleFile struct {
	Name string `json:"name"`
	Size string `json:"size,omitempty"`
	url  string
}

type Assrt struct {
	dir     string
	base    string
	http    *http.Client
	limiter *rate.Limiter
	mu      sync.Mutex
	token   string
}

var (
	assrtOnce     sync.Once
	assrtInstance *Assrt
)

// Subtitles returns the process-wide assrt client rooted in the data directory.
func Subtitles(dataDir string) *Assrt {
	assrtOnce.Do(func() {
		dir := filepath.Join(dataDir, "tgvio")
		token := strings.TrimSpace(Env("OPENLIST_ASSRT_TOKEN", "TGVIO_ASSRT_TOKEN"))
		if token == "" {
			if raw, err := os.ReadFile(filepath.Join(dir, "assrt_token")); err == nil {
				token = strings.TrimSpace(string(raw))
			}
		}
		base := "https://api.assrt.net/v1/"
		if alt := strings.TrimSpace(Env("OPENLIST_ASSRT_BASE", "TGVIO_ASSRT_BASE")); alt != "" { // tests point it at a stand-in
			base = strings.TrimRight(alt, "/") + "/"
		}
		assrtInstance = &Assrt{dir: dir, base: base, token: token,
			http: &http.Client{Timeout: 20 * time.Second}, limiter: rate.NewLimiter(rate.Every(4*time.Second), 4)}
	})
	return assrtInstance
}

func (a *Assrt) Enabled() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.token != ""
}

func (a *Assrt) TokenHint() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.token) < 8 {
		return ""
	}
	return "…" + a.token[len(a.token)-4:]
}

// SetToken stores the token (empty removes it).
func (a *Assrt) SetToken(token string) error {
	token = strings.TrimSpace(token)
	if err := os.MkdirAll(a.dir, 0o700); err != nil {
		return err
	}
	path := filepath.Join(a.dir, "assrt_token")
	if token == "" {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
	} else if err := os.WriteFile(path, []byte(token), 0o600); err != nil {
		return err
	}
	a.mu.Lock()
	a.token = token
	a.mu.Unlock()
	return nil
}

// AssrtError is an error answer of the API.
type AssrtError struct {
	Status int
}

func (e AssrtError) Error() string {
	switch e.Status {
	case 20001, 1:
		return "assrt: invalid token"
	case 30900:
		return "assrt: request limit exceeded"
	case 20900:
		return "assrt: subtitle not found"
	case 101:
		return "assrt: keyword too short"
	}
	return fmt.Sprintf("assrt: error %d", e.Status)
}

func (a *Assrt) call(ctx context.Context, endpoint string, query url.Values, out any) error {
	a.mu.Lock()
	token := a.token
	a.mu.Unlock()
	if token == "" {
		return errors.New("assrt is not configured")
	}
	if err := a.limiter.Wait(ctx); err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.base+endpoint+"?"+query.Encode(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	Inc("assrt_api")
	resp, err := a.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return err
	}
	var head struct {
		Status int `json:"status"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return fmt.Errorf("assrt: HTTP %d", resp.StatusCode)
	}
	if head.Status != 0 {
		return AssrtError{head.Status}
	}
	return json.Unmarshal(raw, out)
}

// assrt answers a search in one of two shapes, and which one comes back has
// changed between calls: the plain one (id/native_name/lang.desc) and the
// older m_-prefixed one (fileid/sub_name/m_title/m_lang). Both are read here.
type assrtSub struct {
	ID          int     `json:"id"`
	FileID      string  `json:"fileid"`
	NativeName  string  `json:"native_name"`
	MTitle      string  `json:"m_title"`
	Chinese     string  `json:"video_chinese_name"`
	SubName     string  `json:"sub_name"`
	VideoName   string  `json:"videoname"`
	MVideoName  string  `json:"m_videoname"`
	Subtype     string  `json:"subtype"`
	MSubtype    string  `json:"m_subtype"`
	UploadTime  string  `json:"upload_time"`
	UploadTime2 string  `json:"uploadtime"`
	VoteScore   float64 `json:"vote_score"`
	Score       string  `json:"score"`
	Lang        struct {
		Desc string `json:"desc"`
	} `json:"lang"`
	MLang    string `json:"m_lang"`
	Filename string `json:"filename"`
	Size     any    `json:"size"`
	URL      string `json:"url"`
	FileList []struct {
		URL string `json:"url"`
		F   string `json:"f"`
		S   string `json:"s"`
	} `json:"filelist"`
}

// result turns either shape into what the page shows.
func (s assrtSub) result() (SubtitleResult, bool) {
	id := s.ID
	if id <= 0 {
		if n, err := strconv.Atoi(strings.TrimSpace(s.FileID)); err == nil {
			id = n
		}
	}
	if id <= 0 {
		return SubtitleResult{}, false
	}
	name := s.NativeName
	if name == "" {
		name = s.MTitle
	}
	if name == "" {
		name = s.Chinese
	}
	if name == "" {
		name = strings.TrimSuffix(s.SubName, filepath.Ext(s.SubName))
	}
	video := s.VideoName
	if video == "" {
		video = s.MVideoName
	}
	kind := s.Subtype
	if len(kind) < 3 { // "2", "5" and the like are codes, not a format
		kind = s.MSubtype
	}
	lang := s.Lang.Desc
	if lang == "" {
		lang = strings.NewReplacer("&nbsp;", " ", "&amp;", "&").Replace(s.MLang)
	}
	score := s.VoteScore
	if score == 0 {
		if n, err := strconv.ParseFloat(strings.TrimSpace(s.Score), 64); err == nil {
			score = n
		}
	}
	uploaded := s.UploadTime
	if uploaded == "" {
		uploaded = s.UploadTime2
	}
	return SubtitleResult{ID: id, Name: name, Video: video, Lang: strings.TrimSpace(lang), Type: kind, Score: score, Uploaded: uploaded}, true
}

type assrtAnswer struct {
	Sub struct {
		Subs []assrtSub `json:"subs"`
	} `json:"sub"`
}

var videoExtension = regexp.MustCompile(`(?i)\.[a-z0-9]{2,4}$`)

// Search finds subtitles. fileName is a video's name (matched by its release
// details); query a free search when the person typed one.
func (a *Assrt) Search(ctx context.Context, fileName, query string) ([]SubtitleResult, error) {
	q := url.Values{"cnt": {"15"}}
	if strings.TrimSpace(query) != "" {
		q.Set("q", strings.TrimSpace(query))
	} else {
		q.Set("q", videoExtension.ReplaceAllString(fileName, ""))
		q.Set("is_file", "1")
	}
	if len([]rune(q.Get("q"))) < 3 {
		return nil, AssrtError{101}
	}
	var answer assrtAnswer
	if err := a.call(ctx, "sub/search", q, &answer); err != nil {
		return nil, err
	}
	out := make([]SubtitleResult, 0, len(answer.Sub.Subs))
	for _, s := range answer.Sub.Subs {
		if item, ok := s.result(); ok {
			out = append(out, item)
		}
	}
	return out, nil
}

var subtitleFile = regexp.MustCompile(`(?i)\.(ass|ssa|srt|vtt|sup|idx|sub)$`)

// Files lists the subtitle files of one result (the files of its archive, or the file itself).
func (a *Assrt) Files(ctx context.Context, id int) ([]SubtitleFile, error) {
	var answer assrtAnswer
	if err := a.call(ctx, "sub/detail", url.Values{"id": {strconv.Itoa(id)}}, &answer); err != nil {
		return nil, err
	}
	if len(answer.Sub.Subs) == 0 {
		return nil, AssrtError{20900}
	}
	s := answer.Sub.Subs[0]
	var out []SubtitleFile
	for _, f := range s.FileList {
		if f.URL != "" && subtitleFile.MatchString(f.F) {
			out = append(out, SubtitleFile{Name: filepath.Base(f.F), Size: f.S, url: f.URL})
		}
	}
	if len(out) == 0 && s.URL != "" && subtitleFile.MatchString(s.Filename) {
		out = append(out, SubtitleFile{Name: s.Filename, url: s.URL})
	}
	return out, nil
}

// Download fetches one file of a result by name (download links expire, so the
// detail is asked again). Subtitles are small: more than 8 MB is refused.
func (a *Assrt) Download(ctx context.Context, id int, name string) ([]byte, error) {
	files, err := a.Files(ctx, id)
	if err != nil {
		return nil, err
	}
	for _, f := range files {
		if f.Name != name {
			continue
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, f.url, nil)
		if err != nil {
			return nil, err
		}
		resp, err := a.http.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			// assrt answers 49x with its own error page when a file cannot be
			// served (a bad mirror, a transient fault): say so plainly.
			if resp.StatusCode >= 490 && resp.StatusCode < 500 {
				return nil, errors.New("这个字幕文件射手网暂时取不到，换一个试试")
			}
			return nil, fmt.Errorf("assrt download: HTTP %d", resp.StatusCode)
		}
		data, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20+1))
		if err != nil {
			return nil, err
		}
		if len(data) > 8<<20 {
			return nil, errors.New("assrt download: file too large")
		}
		return data, nil
	}
	return nil, AssrtError{20900}
}

// Quota asks how many requests are left this minute (a token check).
func (a *Assrt) Quota(ctx context.Context) (int, error) {
	var answer struct {
		User struct {
			Quota int `json:"quota"`
		} `json:"user"`
	}
	if err := a.call(ctx, "user/quota", url.Values{}, &answer); err != nil {
		return 0, err
	}
	return answer.User.Quota, nil
}

// SubtitleName is the name a downloaded subtitle gets beside its video:
// "<video>.<lang>.<ext>", the language read from the file's own name or the
// result's description.
func SubtitleName(video, file, lang string) string {
	base := strings.TrimSuffix(video, filepath.Ext(video))
	ext := strings.ToLower(filepath.Ext(file))
	tag := ""
	text := strings.ToLower(file + " " + lang)
	switch {
	case strings.Contains(text, "双语") || strings.Contains(text, "简英") || strings.Contains(text, "chs&eng") || strings.Contains(text, "chs.eng"):
		tag = "chs&eng"
	case strings.Contains(text, "繁") || strings.Contains(text, "cht") || strings.Contains(text, "big5"):
		tag = "cht"
	case strings.Contains(text, "简") || strings.Contains(text, "chs") || strings.Contains(text, "gb"):
		tag = "chs"
	case strings.Contains(text, "英") || strings.Contains(text, "eng"):
		tag = "eng"
	default:
		tag = "zh"
	}
	return base + "." + tag + ext
}
