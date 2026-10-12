package tgvio

import (
	"context"
	"net/http"
)

// CloudQuality is one version of a video the drive transcoded on its side.
type CloudQuality struct {
	ID        string `json:"id"`   // the drive's name for it, e.g. "UD"
	Name      string `json:"name"` // what a person reads, e.g. "1080P"
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	Bandwidth int    `json:"bandwidth"`
}

// CloudSegment is one piece of a transcoded video.
type CloudSegment struct {
	Duration float64
	URL      string
}

// CloudPlaylist is the segment list of one quality.
type CloudPlaylist struct {
	TargetDuration int
	Segments       []CloudSegment
}

// CloudVideo is implemented by drives that transcode videos themselves (115).
// The file argument is the object the storage returned for the path.
type CloudVideo interface {
	CloudQualities(ctx context.Context, file any) ([]CloudQuality, error)
	CloudPlaylist(ctx context.Context, file any, quality string) (*CloudPlaylist, error)
	// CloudSegmentGet fetches one segment; range is passed through when set.
	CloudSegmentGet(ctx context.Context, url string, rangeHeader string) (*http.Response, error)
	// CloudForget drops a cached playlist whose segments stopped working.
	CloudForget(file any, quality string)
}
