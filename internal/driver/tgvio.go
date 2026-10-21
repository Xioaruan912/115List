package driver

import (
	"context"

	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/tgvio"
)

// BatchRemove removes several objects of one storage in a single drive call.
// TGVIO deletes a video's cover, renditions and original together; one call
// instead of one per file keeps deletions quick and spares the drive's rate limit.
type BatchRemove interface {
	BatchRemove(ctx context.Context, objs []model.Obj) error
}

// RecycleBin lists and permanently empties chosen entries of a drive's recycle
// bin. Deletes through OpenList only move files there; TGVIO's deletions free
// space only once those entries are cleaned.
type RecycleBin interface {
	RecycleList(ctx context.Context, offset, limit int) ([]tgvio.RecycleItem, error)
	// password is the account's security key, when the drive asks for one (115: six digits).
	RecycleClean(ctx context.Context, ids []string, password string) error
}

// FolderBrowser lists the folders under a drive folder id, so an admin can pick
// a mount root by clicking instead of looking up its id.
type FolderBrowser interface {
	DriveFolders(ctx context.Context, id string) ([]tgvio.DriveFolder, error)
}
