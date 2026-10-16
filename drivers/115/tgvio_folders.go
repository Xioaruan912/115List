package _115

import (
	"context"
	"sort"

	"github.com/OpenListTeam/OpenList/v4/internal/tgvio"
	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

// DriveFolders lists the folders directly under a 115 folder id ("0" is the
// drive's root), whatever this storage's own root is. One list call, through
// the shared guard like every other 115 call.
func (d *Pan115) DriveFolders(ctx context.Context, id string) ([]tgvio.DriveFolder, error) {
	if id == "" {
		id = "0"
	}
	if err := d.WaitLimit(ctx); err != nil {
		return nil, err
	}
	files, err := d.getFiles(id)
	if err != nil {
		return nil, err
	}
	out := []tgvio.DriveFolder{}
	for _, f := range files {
		if f.IsDir() {
			out = append(out, tgvio.DriveFolder{ID: f.GetID(), Name: f.GetName()})
		}
	}
	order := collate.New(language.Chinese, collate.Numeric)
	sort.SliceStable(out, func(i, j int) bool { return order.CompareString(out[i].Name, out[j].Name) < 0 })
	return out, nil
}
