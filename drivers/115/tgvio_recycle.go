package _115

import (
	"context"

	"github.com/OpenListTeam/OpenList/v4/internal/driver"
	"github.com/OpenListTeam/OpenList/v4/internal/tgvio"
)

// The recycle bin is per account, so every 115 storage of one account sees the
// same entries. Both calls go through the shared guard like any other 115 call.

func (d *Pan115) RecycleList(ctx context.Context, offset, limit int) ([]tgvio.RecycleItem, error) {
	if err := d.WaitLimit(ctx); err != nil {
		return nil, err
	}
	items, err := d.client.ListRecycleBin(offset, limit)
	if err != nil {
		return nil, err
	}
	out := make([]tgvio.RecycleItem, 0, len(items))
	for _, item := range items {
		out = append(out, tgvio.RecycleItem{
			ID: item.FileId, Name: item.FileName, Size: int64(item.FileSize),
			Parent: item.ParentName, DeletedAt: int64(item.DeleteTime),
		})
	}
	return out, nil
}

// RecycleClean permanently removes the given entries. It never empties the whole
// bin: an empty id list would mean "everything" to the drive, so it is refused.
func (d *Pan115) RecycleClean(ctx context.Context, ids []string, password string) error {
	if len(ids) == 0 {
		return errNoRecycleIDs
	}
	if err := d.WaitLimit(ctx); err != nil {
		return err
	}
	return d.client.CleanRecycleBin(password, ids...)
}

var _ driver.RecycleBin = (*Pan115)(nil)
