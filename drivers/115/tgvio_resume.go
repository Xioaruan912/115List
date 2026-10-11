package _115

import (
	"context"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/tgvio"
	driver115 "github.com/SheltonZhu/115driver/pkg/driver"
	"github.com/aliyun/aliyun-oss-go-sdk/oss"
)

// Resuming a large upload across requests.
//
// Every upload init hands out a new OSS object, so a retried PUT cannot find
// its earlier parts through a fresh init. Instead the earlier upload's own
// parameters and OSS upload id are kept for a while: when the same file is put
// into the same folder again, the parts OSS already holds are skipped and the
// upload is completed with those earlier parameters. Anything that does not
// line up (the upload id is gone, a part has another size, the completion is
// refused) drops the record and the file is uploaded in full with the fresh
// parameters, which is what happened before this existed. Records live in
// memory only and are never more than resumeWindow old.

const resumeWindow = 45 * time.Minute

type uploadSession struct {
	params driver115.UploadOSSParams
	imur   oss.InitiateMultipartUploadResult
	saved  time.Time
}

var uploadSessions = struct {
	sync.Mutex
	m   map[string]uploadSession
	now func() time.Time
}{m: map[string]uploadSession{}, now: time.Now}

func resumeKey(sha1 string, size int64, dirID, name string) string {
	return sha1 + "|" + strconv.FormatInt(size, 10) + "|" + dirID + "|" + name
}

func loadUploadSession(key string) (uploadSession, bool) {
	uploadSessions.Lock()
	defer uploadSessions.Unlock()
	now := uploadSessions.now()
	for k, s := range uploadSessions.m {
		if now.Sub(s.saved) > resumeWindow {
			delete(uploadSessions.m, k)
		}
	}
	s, ok := uploadSessions.m[key]
	return s, ok
}

func saveUploadSession(key string, s uploadSession) {
	uploadSessions.Lock()
	defer uploadSessions.Unlock()
	s.saved = uploadSessions.now()
	uploadSessions.m[key] = s
}

func dropUploadSession(key string) {
	uploadSessions.Lock()
	defer uploadSessions.Unlock()
	delete(uploadSessions.m, key)
}

type partLister interface {
	ListUploadedParts(imur oss.InitiateMultipartUploadResult, options ...oss.Option) (oss.ListUploadedPartsResult, error)
}

// uploadedParts returns the parts OSS already holds for an upload, by number.
func uploadedParts(bucket partLister, imur oss.InitiateMultipartUploadResult, options ...oss.Option) (map[int]oss.UploadedPart, error) {
	parts := map[int]oss.UploadedPart{}
	marker := 0
	for {
		result, err := bucket.ListUploadedParts(imur, append(options, oss.MaxParts(1000), oss.PartNumberMarker(marker))...)
		if err != nil {
			return nil, err
		}
		for _, part := range result.UploadedParts {
			parts[part.PartNumber] = part
		}
		if !result.IsTruncated {
			return parts, nil
		}
		next, err := strconv.Atoi(result.NextPartNumberMarker)
		if err != nil || next <= marker {
			return parts, nil
		}
		marker = next
	}
}

// splitDone separates chunks OSS already holds (same number and size) from the
// ones still to upload. Done parts are returned in part-number order.
func splitDone(chunks []oss.FileChunk, held map[int]oss.UploadedPart) (done []oss.UploadPart, remaining []oss.FileChunk) {
	for _, chunk := range chunks {
		if part, ok := held[chunk.Number]; ok && int64(part.Size) == chunk.Size {
			done = append(done, oss.UploadPart{PartNumber: part.PartNumber, ETag: part.ETag})
			continue
		}
		remaining = append(remaining, chunk)
	}
	return done, remaining
}

func sortParts(parts []oss.UploadPart) {
	sort.Slice(parts, func(i, j int) bool { return parts[i].PartNumber < parts[j].PartNumber })
}

// partRetryWait is the pause before retry n (1-based) of one part: 1, 2, 4, 8 s.
func partRetryWait(ctx context.Context, n int) bool {
	timer := time.NewTimer(time.Second << (n - 1))
	defer timer.Stop()
	select {
	case <-timer.C:
		return true
	case <-ctx.Done():
		return false
	}
}

func countResume(outcome string) { tgvio.Inc("115_upload_resume_" + outcome) }
