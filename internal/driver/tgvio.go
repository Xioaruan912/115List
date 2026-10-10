package driver

import (
	"context"

	"github.com/OpenListTeam/OpenList/v4/internal/model"
)

// BatchRemove removes several objects of one storage in a single drive call.
// TGVIO deletes a video's cover, renditions and original together; one call
// instead of one per file keeps deletions quick and spares the drive's rate limit.
type BatchRemove interface {
	BatchRemove(ctx context.Context, objs []model.Obj) error
}
