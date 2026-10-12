package _115

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/tgvio"
	"github.com/pkg/errors"
)

// Cloud playback: 115 keeps its own HLS transcodes of most videos (4K, 1080P and
// lower). Browsers that cannot decode the original (H.265, MKV) play these.
//
// Cost on the drive's API: one master playlist per video and one variant
// playlist per quality watched, each cached for half an hour and fetched through
// the shared guard (token bucket and 405 breaker). The segments come from the
// transcode CDN, not the API; their URLs are signed for the User-Agent that
// fetched the playlist and only allow 115.com by CORS, so the server fetches
// them with that same User-Agent and passes the bytes on.

const cloudTTL = 30 * time.Minute

var _ tgvio.CloudVideo = (*Pan115)(nil)

type cloudMaster struct {
	at        time.Time
	qualities []tgvio.CloudQuality
	variants  map[string]string // quality id -> playlist URL
}

type cloudVariant struct {
	at       time.Time
	playlist *tgvio.CloudPlaylist
}

var cloud = struct {
	sync.Mutex
	masters  map[string]*cloudMaster
	variants map[string]*cloudVariant
	inflight map[string]*sync.Mutex
}{masters: map[string]*cloudMaster{}, variants: map[string]*cloudVariant{}, inflight: map[string]*sync.Mutex{}}

// keyLock serialises fetches of one key, so ten requests for one cold playlist
// make one drive call.
func keyLock(key string) *sync.Mutex {
	cloud.Lock()
	defer cloud.Unlock()
	lock, ok := cloud.inflight[key]
	if !ok {
		lock = &sync.Mutex{}
		cloud.inflight[key] = lock
	}
	return lock
}

func pickCodeOf(file any) (string, error) {
	for {
		switch obj := file.(type) {
		case *FileObj:
			if obj.PickCode == "" {
				return "", errors.New("file has no pick code")
			}
			return obj.PickCode, nil
		case interface{ Unwrap() model.Obj }:
			file = obj.Unwrap()
		default:
			return "", fmt.Errorf("not a 115 file: %T", file)
		}
	}
}

var (
	streamInf    = regexp.MustCompile(`([A-Z-]+)=("[^"]*"|[^,]*)`)
	qualityNames = map[string]string{"BD": "4K", "UD": "1080P", "HD": "720P", "SD": "480P", "YH": "原画"}
)

func qualityName(id string, height int) string {
	switch {
	case height >= 2000:
		return "4K"
	case height >= 1400:
		return "2K"
	case height >= 1000:
		return "1080P"
	case height >= 700:
		return "720P"
	case height >= 460:
		return "480P"
	case height > 0:
		return fmt.Sprintf("%dP", height)
	}
	if name, ok := qualityNames[id]; ok {
		return name
	}
	return id
}

// parseMaster reads the master playlist: one EXT-X-STREAM-INF line per quality,
// the playlist URL on the next line.
func parseMaster(body string, base *url.URL) ([]tgvio.CloudQuality, map[string]string) {
	var qualities []tgvio.CloudQuality
	variants := map[string]string{}
	var pending *tgvio.CloudQuality
	scanner := bufio.NewScanner(strings.NewReader(body))
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		switch {
		case strings.HasPrefix(line, "#EXT-X-STREAM-INF:"):
			q := tgvio.CloudQuality{}
			for _, m := range streamInf.FindAllStringSubmatch(strings.TrimPrefix(line, "#EXT-X-STREAM-INF:"), -1) {
				value := strings.Trim(m[2], `"`)
				switch m[1] {
				case "BANDWIDTH":
					q.Bandwidth, _ = strconv.Atoi(value)
				case "RESOLUTION":
					if w, h, ok := strings.Cut(value, "x"); ok {
						q.Width, _ = strconv.Atoi(w)
						q.Height, _ = strconv.Atoi(h)
					}
				case "NAME":
					q.ID = value
				}
			}
			pending = &q
		case pending != nil && line != "" && !strings.HasPrefix(line, "#"):
			ref, err := url.Parse(line)
			if err == nil {
				if pending.ID == "" {
					pending.ID = strconv.Itoa(pending.Bandwidth)
				}
				if _, seen := variants[pending.ID]; !seen {
					pending.Name = qualityName(pending.ID, pending.Height)
					variants[pending.ID] = base.ResolveReference(ref).String()
					qualities = append(qualities, *pending)
				}
			}
			pending = nil
		}
	}
	return qualities, variants
}

// parseVariant reads a media playlist into segment durations and absolute URLs.
func parseVariant(body string, base *url.URL) *tgvio.CloudPlaylist {
	playlist := &tgvio.CloudPlaylist{TargetDuration: 10}
	duration := 0.0
	scanner := bufio.NewScanner(strings.NewReader(body))
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		switch {
		case strings.HasPrefix(line, "#EXT-X-TARGETDURATION:"):
			if value, err := strconv.Atoi(strings.TrimPrefix(line, "#EXT-X-TARGETDURATION:")); err == nil {
				playlist.TargetDuration = value
			}
		case strings.HasPrefix(line, "#EXTINF:"):
			value, _, _ := strings.Cut(strings.TrimPrefix(line, "#EXTINF:"), ",")
			duration, _ = strconv.ParseFloat(value, 64)
		case line != "" && !strings.HasPrefix(line, "#"):
			if ref, err := url.Parse(line); err == nil {
				playlist.Segments = append(playlist.Segments, tgvio.CloudSegment{Duration: duration, URL: base.ResolveReference(ref).String()})
			}
			duration = 0
		}
	}
	return playlist
}

func (d *Pan115) cloudMaster(ctx context.Context, pickCode string) (*cloudMaster, error) {
	lock := keyLock("m:" + pickCode)
	lock.Lock()
	defer lock.Unlock()
	cloud.Lock()
	cached := cloud.masters[pickCode]
	cloud.Unlock()
	if cached != nil && time.Since(cached.at) < cloudTTL {
		return cached, nil
	}
	if err := d.WaitLimit(ctx); err != nil {
		return nil, err
	}
	tgvio.Inc("cloud_video_master")
	address := "https://115.com/api/video/m3u8/" + pickCode + ".m3u8"
	resp, err := d.client.NewRequest().SetContext(ctx).Get(address)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode() != http.StatusOK {
		return nil, fmt.Errorf("master playlist: HTTP %d", resp.StatusCode())
	}
	base, _ := url.Parse(address)
	qualities, variants := parseMaster(string(resp.Body()), base)
	master := &cloudMaster{at: time.Now(), qualities: qualities, variants: variants}
	cloud.Lock()
	cloud.masters[pickCode] = master
	cloud.Unlock()
	return master, nil
}

// CloudQualities lists the transcoded versions, best first; none when the drive has not transcoded the file.
func (d *Pan115) CloudQualities(ctx context.Context, file any) ([]tgvio.CloudQuality, error) {
	pickCode, err := pickCodeOf(file)
	if err != nil {
		return nil, err
	}
	master, err := d.cloudMaster(ctx, pickCode)
	if err != nil {
		return nil, err
	}
	return master.qualities, nil
}

// CloudPlaylist returns the segments of one quality.
func (d *Pan115) CloudPlaylist(ctx context.Context, file any, quality string) (*tgvio.CloudPlaylist, error) {
	pickCode, err := pickCodeOf(file)
	if err != nil {
		return nil, err
	}
	key := pickCode + "/" + quality
	lock := keyLock("v:" + key)
	lock.Lock()
	defer lock.Unlock()
	cloud.Lock()
	cached := cloud.variants[key]
	cloud.Unlock()
	if cached != nil && time.Since(cached.at) < cloudTTL {
		return cached.playlist, nil
	}
	master, err := d.cloudMaster(ctx, pickCode)
	if err != nil {
		return nil, err
	}
	address, ok := master.variants[quality]
	if !ok {
		return nil, fmt.Errorf("no %s version of this video", quality)
	}
	if err := d.WaitLimit(ctx); err != nil {
		return nil, err
	}
	tgvio.Inc("cloud_video_variant")
	resp, err := d.client.NewRequest().SetContext(ctx).Get(address)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode() != http.StatusOK {
		return nil, fmt.Errorf("variant playlist: HTTP %d", resp.StatusCode())
	}
	base, _ := url.Parse(address)
	playlist := parseVariant(string(resp.Body()), base)
	if len(playlist.Segments) == 0 {
		return nil, errors.New("empty playlist")
	}
	cloud.Lock()
	cloud.variants[key] = &cloudVariant{at: time.Now(), playlist: playlist}
	// Drop stale entries now and then so the maps stay small.
	if len(cloud.variants) > 200 {
		for k, v := range cloud.variants {
			if time.Since(v.at) > cloudTTL {
				delete(cloud.variants, k)
			}
		}
		for k, v := range cloud.masters {
			if time.Since(v.at) > cloudTTL {
				delete(cloud.masters, k)
			}
		}
	}
	cloud.Unlock()
	return playlist, nil
}

var segmentClient = &http.Client{Timeout: 90 * time.Second}

// At most this many segment downloads at once for the whole process.
var segmentSlots = make(chan struct{}, 6)

// CloudSegmentGet fetches a segment with the User-Agent its playlist was fetched with.
func (d *Pan115) CloudSegmentGet(ctx context.Context, address string, rangeHeader string) (*http.Response, error) {
	select {
	case segmentSlots <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		<-segmentSlots
		return nil, err
	}
	req.Header.Set("User-Agent", d.getUA())
	req.Header.Set("Referer", "https://115.com/")
	if rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}
	tgvio.Inc("cloud_video_segment")
	resp, err := segmentClient.Do(req)
	if err != nil {
		<-segmentSlots
		return nil, err
	}
	resp.Body = &releasingBody{ReadCloser: resp.Body}
	return resp, nil
}

// CloudForget drops a cached playlist whose segments stopped working.
func (d *Pan115) CloudForget(file any, quality string) {
	if pickCode, err := pickCodeOf(file); err == nil {
		cloud.Lock()
		delete(cloud.variants, pickCode+"/"+quality)
		cloud.Unlock()
	}
}

type releasingBody struct {
	io.ReadCloser
	once sync.Once
}

func (b *releasingBody) Close() error {
	err := b.ReadCloser.Close()
	b.once.Do(func() { <-segmentSlots })
	return err
}
