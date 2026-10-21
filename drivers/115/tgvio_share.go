package _115

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	driver115 "github.com/SheltonZhu/115driver/pkg/driver"
)

// Saving other people's 115 shares into this drive (转存): read what a share
// holds, page by page, then ask 115 to copy the chosen items into a folder.
// Both go through the drive's rate limit like every other 115 call.

// ShareItem is one file or folder of a share.
type ShareItem struct {
	ID    string `json:"id"` // file id, or folder id for a folder
	Name  string `json:"name"`
	IsDir bool   `json:"is_dir"`
	Size  int64  `json:"size"`
}

// ShareSnapshot is one folder of a share.
type ShareSnapshot struct {
	Title string      `json:"title"`
	Count int         `json:"count"`
	Items []ShareItem `json:"items"`
}

const (
	sharePage    = 100
	shareMaxList = 1000
	apiReceive   = "https://webapi.115.com/share/receive"
)

// ShareSnap lists one folder of a share ("" or "0": its top).
func (d *Pan115) ShareSnap(ctx context.Context, shareCode, receiveCode, dirID string) (*ShareSnapshot, error) {
	if dirID == "" {
		dirID = "0"
	}
	out := &ShareSnapshot{}
	for offset := 0; offset < shareMaxList; offset += sharePage {
		if err := d.WaitLimit(ctx); err != nil {
			return nil, err
		}
		resp, err := d.client.GetShareSnapWithUA(d.getUA(), shareCode, receiveCode, dirID,
			driver115.QueryLimit(sharePage), driver115.QueryOffset(offset))
		if err != nil {
			return nil, err
		}
		if offset == 0 {
			out.Title, out.Count = resp.Data.Shareinfo.ShareTitle, resp.Data.Count
			if reason := strings.TrimSpace(resp.Data.Shareinfo.ForbidReason); reason != "" && len(resp.Data.List) == 0 {
				return nil, fmt.Errorf("115 share: %s", reason)
			}
		}
		for _, f := range resp.Data.List {
			item := ShareItem{Name: f.FileName, Size: int64(f.Size)}
			if f.FileID == "" {
				item.ID, item.IsDir = string(f.CategoryID), true
			} else {
				item.ID = f.FileID
			}
			out.Items = append(out.Items, item)
		}
		if len(resp.Data.List) < sharePage || len(out.Items) >= resp.Data.Count {
			break
		}
	}
	return out, nil
}

// ShareReceive copies items of a share (file or folder ids) into a folder of this drive.
func (d *Pan115) ShareReceive(ctx context.Context, shareCode, receiveCode string, ids []string, dstID string) error {
	if len(ids) == 0 {
		return fmt.Errorf("115 share: nothing chosen")
	}
	if err := d.WaitLimit(ctx); err != nil {
		return err
	}
	if d.client.UserID <= 0 {
		user, err := d.client.GetUser()
		if err != nil {
			return err
		}
		d.client.UserID = user.UserID
	}
	result := driver115.BasicResp{}
	resp, err := d.client.NewRequest().SetContext(ctx).
		SetHeader("referer", driver115.BuildShareReferer(shareCode, receiveCode)).
		SetFormData(map[string]string{
			"user_id":      strconv.FormatInt(d.client.UserID, 10),
			"share_code":   shareCode,
			"receive_code": receiveCode,
			"file_id":      strings.Join(ids, ","),
			"cid":          dstID,
		}).
		SetResult(&result).
		ForceContentType("application/json;charset=UTF-8").
		Post(apiReceive)
	if err != nil {
		return err
	}
	if !result.State {
		msg := strings.TrimSpace(result.Error)
		if msg == "" {
			msg = strings.TrimSpace(result.Msg)
		}
		if msg == "" {
			msg = fmt.Sprintf("HTTP %d", resp.StatusCode())
		}
		return fmt.Errorf("115 share: %s", msg)
	}
	return nil
}
