package fs

import (
	"context"

	"github.com/OpenListTeam/OpenList/v4/internal/driver"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/pkg/errors"
	log "github.com/sirupsen/logrus"
)

// RemoveMany removes several paths, grouping them by storage so a storage that
// supports batch removal gets one drive call per request.
func RemoveMany(ctx context.Context, paths []string) error {
	type group struct {
		storage driver.Driver
		paths   []string
	}
	var order []string
	groups := map[string]*group{}
	for _, path := range paths {
		storage, actualPath, err := op.GetStorageAndActualPath(path)
		if err != nil {
			return errors.WithMessage(err, "failed get storage")
		}
		key := storage.GetStorage().MountPath
		g, ok := groups[key]
		if !ok {
			g = &group{storage: storage}
			groups[key] = g
			order = append(order, key)
		}
		g.paths = append(g.paths, actualPath)
	}
	for _, key := range order {
		g := groups[key]
		if err := op.RemoveMany(ctx, g.storage, g.paths); err != nil {
			log.Errorf("failed remove %d objects on %s: %+v", len(g.paths), key, err)
			return err
		}
	}
	return nil
}
