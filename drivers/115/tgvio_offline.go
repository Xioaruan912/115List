package _115

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	crypto "github.com/SheltonZhu/115driver/pkg/crypto/m115"
	driver115 "github.com/SheltonZhu/115driver/pkg/driver"
)

// The 115 SDK reads only the info hashes of add_task_urls and drops each
// link's own state, so a link 115 refused came back as an empty hash with no
// error: the task then found nothing to watch and ended without a word. This
// sends the same request and keeps 115's answer for every link.

type offlineAdded struct {
	State    bool   `json:"state"`
	Errcode  int    `json:"errcode"`
	Errno    int    `json:"errno"`
	ErrorMsg string `json:"error_msg"`
	InfoHash string `json:"info_hash"`
	URL      string `json:"url"`
}

type offlineAddAnswer struct {
	offlineAdded
	Result []offlineAdded `json:"result"`
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

// offlineHashes picks the task hash of every link from 115's answer, or the reason it was refused.
func offlineHashes(answer offlineAddAnswer, count int) ([]string, error) {
	items := answer.Result
	if len(items) == 0 {
		if !answer.State && (answer.ErrorMsg != "" || answer.Errcode != 0 || answer.Errno != 0) {
			return nil, answer.err()
		}
		if answer.InfoHash != "" {
			items = []offlineAdded{answer.offlineAdded}
		}
	}
	if len(items) < count {
		return nil, fmt.Errorf("115 offline download: answered %d of %d links", len(items), count)
	}
	hashes := make([]string, count)
	for i := 0; i < count; i++ {
		item := items[i]
		exists := item.Errcode == offlineTaskExists || item.Errno == offlineTaskExists
		if item.InfoHash == "" || (!item.State && !exists) {
			return nil, item.err()
		}
		hashes[i] = item.InfoHash
	}
	return hashes, nil
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
	params := map[string]string{
		"ac":         "add_task_urls",
		"wp_path_id": dirID,
		"app_ver":    appVer,
		"uid":        strconv.FormatInt(d.client.UserID, 10),
	}
	for i, uri := range uris {
		params[fmt.Sprintf("url[%d]", i)] = uri
	}
	body, err := json.Marshal(params)
	if err != nil {
		return nil, err
	}
	key := crypto.GenerateKey()
	result := driver115.DownloadResp{}
	resp, err := d.client.NewRequest().
		SetContext(ctx).
		SetQueryParam("t", driver115.Now().String()).
		SetFormData(map[string]string{"data": crypto.Encode(body, key)}).
		ForceContentType("application/json").
		SetResult(&result).
		Post(driver115.ApiAddOfflineUrl)
	if err := driver115.CheckErr(err, &result, resp); err != nil {
		return nil, err
	}
	plain, err := crypto.Decode(string(result.EncodedData), key)
	if err != nil {
		return nil, err
	}
	var answer offlineAddAnswer
	if err := json.Unmarshal(plain, &answer); err != nil {
		return nil, err
	}
	return offlineHashes(answer, len(uris))
}
