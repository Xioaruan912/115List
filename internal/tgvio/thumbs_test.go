package tgvio

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestPickSegment(t *testing.T) {
	p := &CloudPlaylist{}
	for i := 0; i < 100; i++ {
		p.Segments = append(p.Segments, CloudSegment{Duration: 10})
	}
	if got := pickSegment(p); got != 20 {
		t.Errorf("1000 s video: segment %d, want 20", got)
	}
	long := &CloudPlaylist{}
	for i := 0; i < 600; i++ {
		long.Segments = append(long.Segments, CloudSegment{Duration: 10})
	}
	if got := pickSegment(long); got != 30 {
		t.Errorf("long video: segment %d, want 30 (five minutes in)", got)
	}
}

func TestThumbName(t *testing.T) {
	key := ThumbKey(3, "/a/b.mkv", 10, time.Unix(100, 0))
	if got, ok := ThumbName(key + ".jpg"); !ok || got != key {
		t.Errorf("ThumbName(%q) = %q %v", key, got, ok)
	}
	for _, bad := range []string{"../x.jpg", key + ".png", "zz" + key[2:] + ".jpg"} {
		if _, ok := ThumbName(bad); ok {
			t.Errorf("ThumbName(%q) accepted", bad)
		}
	}
	if ThumbKey(3, "/a/b.mkv", 11, time.Unix(100, 0)) == key {
		t.Error("a changed file kept its key")
	}
}

type fakeCloud struct {
	segment string
	none    bool
}

func (f fakeCloud) CloudQualities(context.Context, any) ([]CloudQuality, error) {
	if f.none {
		return nil, nil
	}
	return []CloudQuality{{ID: "BD", Height: 2160}, {ID: "UD", Height: 1080}}, nil
}
func (f fakeCloud) CloudPlaylist(_ context.Context, _ any, q string) (*CloudPlaylist, error) {
	if q != "UD" {
		panic("should take the smallest quality, got " + q)
	}
	return &CloudPlaylist{Segments: []CloudSegment{{Duration: 2, URL: f.segment}}}, nil
}
func (f fakeCloud) CloudSegmentGet(ctx context.Context, url, _ string) (*http.Response, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	return http.DefaultClient.Do(req)
}
func (fakeCloud) CloudForget(any, string) {}

func TestMakeThumb(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("no ffmpeg")
	}
	dir := t.TempDir()
	ts := filepath.Join(dir, "seg.ts")
	if out, err := exec.Command("ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=25",
		"-t", "2", "-c:v", "libx264", "-f", "mpegts", ts).CombinedOutput(); err != nil {
		t.Skipf("cannot make a test video: %v %s", err, out)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.ServeFile(w, r, ts) }))
	defer srv.Close()
	thumbs := &Thumbs{dir: filepath.Join(dir, "thumbs"), queued: map[string]bool{}}
	if err := thumbs.make(context.Background(), thumbJob{key: "k1", cloud: fakeCloud{segment: srv.URL}}); err != nil {
		t.Fatal(err)
	}
	path, ok := thumbs.File("k1")
	if !ok {
		t.Fatal("no thumbnail written")
	}
	raw, _ := os.ReadFile(path)
	if len(raw) < 1000 || raw[0] != 0xFF || raw[1] != 0xD8 {
		t.Errorf("not a JPEG: %d bytes", len(raw))
	}
	if err := thumbs.make(context.Background(), thumbJob{key: "k2", cloud: fakeCloud{none: true}}); err != errNoTranscode {
		t.Errorf("no transcode: got %v", err)
	}
}
