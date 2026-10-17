package _115

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	driver115 "github.com/SheltonZhu/115driver/pkg/driver"
)

// Adding offline tasks. The SDK posts to lixianssp with its own m115
// encryption, which 115 now answers with a bare "decode fail!", and it read
// only the info hashes, so a refused link came back as an empty hash with no
// error. This uses the endpoint 115's web page uses (a sign from the offline
// space call, then one plain form per link) and keeps 115's answer for every link.

type offlineAdded struct {
	State    bool   `json:"state"`
	Errcode  int    `json:"errcode"`
	Errno    int    `json:"errno"`
	ErrorMsg string `json:"error_msg"`
	InfoHash string `json:"info_hash"`
	URL      string `json:"url"`
}

// 115 answers 10008 for a link already in the list; the existing task is the one to follow.
const offlineTaskExists = 10008

func (a offlineAdded) err() error {
	code := a.Errcode
	if code == 0 {
		code = a.Errno
	}
	msg := strings.TrimSpace(a.ErrorMsg)
	if msg == "" {
		msg = "115 refused the link"
	}
	return fmt.Errorf("115 offline download: %s (code %d)", msg, code)
}

// offlineHash is the task hash of a link from 115's answer, or the reason it was refused.
func offlineHash(answer offlineAdded) (string, error) {
	exists := answer.Errcode == offlineTaskExists || answer.Errno == offlineTaskExists
	if answer.InfoHash == "" || (!answer.State && !exists) {
		return "", answer.err()
	}
	return answer.InfoHash, nil
}

const (
	offlineSpaceURL = "https://115.com/"
	offlineAddURL   = "https://115.com/web/lixian/?ct=lixian&ac=add_task_url"
)

type offlineSpace struct {
	State bool   `json:"state"`
	Sign  string `json:"sign"`
	Time  int64  `json:"time"`
}

func (d *Pan115) addOfflineTasks(ctx context.Context, uris []string, dirID string) ([]string, error) {
	if len(uris) == 0 {
		return nil, nil
	}
	if err := d.WaitLimit(ctx); err != nil {
		return nil, err
	}
	if d.client.UserID <= 0 {
		user, err := d.client.GetUser()
		if err != nil {
			return nil, err
		}
		d.client.UserID = user.UserID
	}
	var space offlineSpace
	resp, err := d.client.NewRequest().SetContext(ctx).
		SetQueryParams(map[string]string{"ct": "offline", "ac": "space", "_": driver115.Now().String()}).
		Get(offlineSpaceURL)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(resp.Body(), &space); err != nil || !space.State || space.Sign == "" {
		return nil, fmt.Errorf("115 offline download: no sign from 115 (HTTP %d)", resp.StatusCode())
	}
	hashes := make([]string, 0, len(uris))
	for _, uri := range uris {
		if err := d.WaitLimit(ctx); err != nil {
			return nil, err
		}
		resp, err := d.client.NewRequest().SetContext(ctx).
			SetFormData(map[string]string{
				"url":        uri,
				"wp_path_id": dirID,
				"uid":        strconv.FormatInt(d.client.UserID, 10),
				"sign":       space.Sign,
				"time":       strconv.FormatInt(space.Time, 10),
			}).
			Post(offlineAddURL)
		if err != nil {
			return nil, err
		}
		var answer offlineAdded
		if err := json.Unmarshal(resp.Body(), &answer); err != nil {
			return nil, fmt.Errorf("115 offline download: unreadable answer (HTTP %d)", resp.StatusCode())
		}
		hash, err := offlineHash(answer)
		if err != nil {
			return nil, err
		}
		hashes = append(hashes, hash)
	}
	return hashes, nil
}
