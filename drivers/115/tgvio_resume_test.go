package _115

import (
	"context"
	"errors"
	"strconv"
	"testing"
	"time"

	"github.com/aliyun/aliyun-oss-go-sdk/oss"
)

type fakeLister struct {
	parts []oss.UploadedPart
	page  int
	calls int
	err   error
}

func (f *fakeLister) ListUploadedParts(_ oss.InitiateMultipartUploadResult, options ...oss.Option) (oss.ListUploadedPartsResult, error) {
	f.calls++
	if f.err != nil {
		return oss.ListUploadedPartsResult{}, f.err
	}
	start := (f.calls - 1) * f.page
	end := min(start+f.page, len(f.parts))
	result := oss.ListUploadedPartsResult{UploadedParts: f.parts[start:end]}
	if end < len(f.parts) {
		result.IsTruncated = true
		result.NextPartNumberMarker = strconv.Itoa(f.parts[end-1].PartNumber)
	}
	return result, nil
}

func TestUploadedPartsFollowsPages(t *testing.T) {
	lister := &fakeLister{page: 2}
	for n := 1; n <= 5; n++ {
		lister.parts = append(lister.parts, oss.UploadedPart{PartNumber: n, ETag: "e" + strconv.Itoa(n), Size: 10})
	}
	held, err := uploadedParts(lister, oss.InitiateMultipartUploadResult{})
	if err != nil || len(held) != 5 || lister.calls != 3 {
		t.Fatalf("want 5 parts over 3 pages, got %d parts in %d calls (%v)", len(held), lister.calls, err)
	}
	if _, err := uploadedParts(&fakeLister{err: errors.New("NoSuchUpload")}, oss.InitiateMultipartUploadResult{}); err == nil {
		t.Fatal("a vanished upload is an error, so the caller starts afresh")
	}
}

func TestSplitDoneSkipsOnlyPartsOfTheSameSize(t *testing.T) {
	chunks := []oss.FileChunk{{Number: 1, Size: 10}, {Number: 2, Size: 10}, {Number: 3, Size: 7}}
	held := map[int]oss.UploadedPart{
		2: {PartNumber: 2, ETag: "b", Size: 10},
		1: {PartNumber: 1, ETag: "a", Size: 10},
		3: {PartNumber: 3, ETag: "c", Size: 5}, // a different size: upload again
	}
	done, remaining := splitDone(chunks, held)
	if len(done) != 2 || done[0].PartNumber != 1 || done[1].PartNumber != 2 {
		t.Fatalf("done parts in order: %+v", done)
	}
	if len(remaining) != 1 || remaining[0].Number != 3 {
		t.Fatalf("remaining: %+v", remaining)
	}
}

func TestUploadSessionsExpire(t *testing.T) {
	now := time.Unix(1_000_000, 0)
	uploadSessions.now = func() time.Time { return now }
	defer func() { uploadSessions.now = time.Now }()
	key := resumeKey("SHA", 100, "dir", "a.mp4")
	saveUploadSession(key, uploadSession{})
	if _, ok := loadUploadSession(key); !ok {
		t.Fatal("a fresh record is found")
	}
	now = now.Add(resumeWindow + time.Second)
	if _, ok := loadUploadSession(key); ok {
		t.Fatal("an old record is dropped")
	}
	saveUploadSession(key, uploadSession{})
	dropUploadSession(key)
	if _, ok := loadUploadSession(key); ok {
		t.Fatal("a completed upload leaves no record")
	}
	if resumeKey("SHA", 100, "dir", "a.mp4") == resumeKey("SHA", 100, "dir2", "a.mp4") {
		t.Fatal("another folder is another upload")
	}
}

func TestPartRetryWaitEndsWithTheUpload(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	started := time.Now()
	if partRetryWait(ctx, 4) || time.Since(started) > time.Second {
		t.Fatal("a cancelled upload does not wait out its backoff")
	}
}
