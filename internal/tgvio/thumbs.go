package tgvio

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// Video thumbnails for drives that transcode videos themselves (115), whose
// listings carry no picture for videos. A frame is taken from one short segment
// of the drive's own transcoded copy (the smallest quality, about a fifth of the
// way in) with ffmpeg, and kept forever in <data>/tgvio/thumbs/. Only videos a
// person has had on screen are queued; one is made at a time, at most a few
// hundred an hour, and the queue waits while the drive's breaker is open.

// DriveBusy reports whether the drive asked to be left alone (115's 405 breaker).
var DriveBusy = func() bool { return false }

type thumbJob struct {
	key   string
	cloud CloudVideo
	file  any
}

type Thumbs struct {
	dir    string
	mu     sync.Mutex
	queue  chan thumbJob
	queued map[string]bool
	budget *rate.Limiter
}

var (
	thumbsOnce     sync.Once
	thumbsInstance *Thumbs
)

// VideoThumbs returns the process-wide thumbnail maker rooted in the data directory.
func VideoThumbs(dataDir string) *Thumbs {
	thumbsOnce.Do(func() {
		thumbsInstance = &Thumbs{
			dir:    filepath.Join(dataDir, "tgvio", "thumbs"),
			queue:  make(chan thumbJob, 2000),
			queued: map[string]bool{},
			budget: rate.NewLimiter(rate.Every(12*time.Second), 40), // ~300 an hour, short bursts for one folder
		}
		go thumbsInstance.work()
	})
	return thumbsInstance
}

// ThumbKey names a video's thumbnail; a changed file gets a new one.
func ThumbKey(storage uint, path string, size int64, modified time.Time) string {
	sum := sha1.Sum([]byte(fmt.Sprintf("%d\x00%s\x00%d\x00%d", storage, path, size, modified.Unix())))
	return hex.EncodeToString(sum[:16])
}

func (t *Thumbs) file(key string) string { return filepath.Join(t.dir, key+".jpg") }

// File returns the image of a key, when it has been made.
func (t *Thumbs) File(key string) (string, bool) {
	path := t.file(key)
	if info, err := os.Stat(path); err == nil && info.Size() > 0 {
		return path, true
	}
	return "", false
}

// failed marks videos without a usable transcode; they are tried again after a few days.
func (t *Thumbs) failed(key string) bool {
	info, err := os.Stat(filepath.Join(t.dir, key+".none"))
	return err == nil && time.Since(info.ModTime()) < 72*time.Hour
}

// Want returns whether a thumbnail exists, queueing it when it does not.
// pending is false for videos that have none and will not get one soon.
func (t *Thumbs) Want(key string, cloud CloudVideo, file any) (ready, pending bool) {
	if _, ok := t.File(key); ok {
		return true, false
	}
	if t.failed(key) {
		return false, false
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.queued[key] {
		return false, true
	}
	select {
	case t.queue <- thumbJob{key: key, cloud: cloud, file: file}:
		t.queued[key] = true
		return false, true
	default:
		return false, false // full: asked again on the next visit
	}
}

func (t *Thumbs) work() {
	for job := range t.queue {
		for DriveBusy() {
			time.Sleep(30 * time.Second)
		}
		_ = t.budget.Wait(context.Background())
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		err := t.make(ctx, job)
		cancel()
		t.mu.Lock()
		delete(t.queued, job.key)
		t.mu.Unlock()
		if err != nil {
			Inc("thumb_error")
			if errors.Is(err, errNoTranscode) {
				_ = os.MkdirAll(t.dir, 0o700)
				_ = os.WriteFile(filepath.Join(t.dir, job.key+".none"), nil, 0o600)
			}
			time.Sleep(3 * time.Second)
		} else {
			Inc("thumb_made")
		}
	}
}

var errNoTranscode = errors.New("the drive has no transcoded copy")

// pickSegment chooses the segment about a fifth of the way in (at most five
// minutes in, past a cold open but well before the credits).
func pickSegment(p *CloudPlaylist) int {
	total := 0.0
	for _, s := range p.Segments {
		total += s.Duration
	}
	target := total * 0.2
	if target > 300 {
		target = 300
	}
	at := 0.0
	for i, s := range p.Segments {
		if at+s.Duration > target {
			return i
		}
		at += s.Duration
	}
	return len(p.Segments) / 5
}

func (t *Thumbs) make(ctx context.Context, job thumbJob) error {
	qualities, err := job.cloud.CloudQualities(ctx, job.file)
	if err != nil {
		return err
	}
	if len(qualities) == 0 {
		return errNoTranscode
	}
	smallest := qualities[0]
	for _, q := range qualities {
		if q.Height > 0 && (smallest.Height == 0 || q.Height < smallest.Height) {
			smallest = q
		}
	}
	playlist, err := job.cloud.CloudPlaylist(ctx, job.file, smallest.ID)
	if err != nil {
		return err
	}
	if len(playlist.Segments) == 0 {
		return errNoTranscode
	}
	resp, err := job.cloud.CloudSegmentGet(ctx, playlist.Segments[pickSegment(playlist)].URL, "")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 && resp.StatusCode != 206 {
		job.cloud.CloudForget(job.file, smallest.ID)
		return fmt.Errorf("segment: HTTP %d", resp.StatusCode)
	}
	if err := os.MkdirAll(t.dir, 0o700); err != nil {
		return err
	}
	segment, err := os.CreateTemp(t.dir, "seg-*.ts")
	if err != nil {
		return err
	}
	defer os.Remove(segment.Name())
	_, err = io.Copy(segment, io.LimitReader(resp.Body, 64<<20))
	segment.Close()
	if err != nil {
		return err
	}
	return Frame(ctx, segment.Name(), t.file(job.key))
}

// Frame writes one frame of a video file as a JPEG 480 pixels wide.
func Frame(ctx context.Context, video, out string) error {
	tmp := out + ".tmp.jpg"
	defer os.Remove(tmp)
	for _, seek := range []string{"1", "0"} {
		cmd := exec.CommandContext(ctx, "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
			"-ss", seek, "-i", video, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "5", tmp)
		if output, err := cmd.CombinedOutput(); err != nil {
			if seek == "0" {
				return fmt.Errorf("ffmpeg: %v: %s", err, output)
			}
			continue
		}
		if info, err := os.Stat(tmp); err == nil && info.Size() > 0 {
			return os.Rename(tmp, out)
		}
	}
	return errors.New("ffmpeg made no frame")
}

// ThumbName reports whether a file name is a thumbnail key with its extension.
func ThumbName(name string) (string, bool) {
	if len(name) != 36 || name[32:] != ".jpg" {
		return "", false
	}
	if _, err := hex.DecodeString(name[:32]); err != nil {
		return "", false
	}
	return name[:32], true
}
