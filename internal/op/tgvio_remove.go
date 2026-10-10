package op

import (
	"context"
	stdpath "path"

	"github.com/OpenListTeam/OpenList/v4/internal/driver"
	"github.com/OpenListTeam/OpenList/v4/internal/errs"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/pkg/utils"
	"github.com/pkg/errors"
)

// RemoveMany removes several paths of one storage. A storage that implements
// driver.BatchRemove gets one call for all of them; any other storage, or a
// single path, goes through Remove one path at a time. Objects already gone
// count as removed, like Remove.
func RemoveMany(ctx context.Context, storage driver.Driver, paths []string) error {
	batch, ok := storage.(driver.BatchRemove)
	if !ok || len(paths) < 2 {
		for _, path := range paths {
			if err := Remove(ctx, storage, path); err != nil {
				return err
			}
		}
		return nil
	}
	if storage.Config().CheckStatus && storage.GetStorage().Status != WORK {
		return errors.WithMessagef(errs.StorageNotInit, "storage status: %s", storage.GetStorage().Status)
	}
	type target struct {
		dir string
		obj model.Obj
	}
	targets := make([]target, 0, len(paths))
	objs := make([]model.Obj, 0, len(paths))
	for _, path := range paths {
		path = utils.FixAndCleanPath(path)
		if utils.PathEqual(path, "/") {
			return errors.New("delete root folder is not allowed")
		}
		rawObj, err := Get(ctx, storage, path, true)
		if err != nil {
			if errs.IsObjectNotFound(err) {
				continue
			}
			return errors.WithMessage(err, "failed to get object")
		}
		if model.ObjHasMask(rawObj, model.NoRemove) {
			return errors.WithStack(errs.PermissionDenied)
		}
		targets = append(targets, target{dir: stdpath.Dir(path), obj: rawObj})
		objs = append(objs, model.UnwrapObjName(rawObj))
	}
	if len(objs) == 0 {
		return nil
	}
	if err := batch.BatchRemove(ctx, objs); err != nil {
		return errors.WithStack(err)
	}
	for _, t := range targets {
		Cache.removeDirectoryObject(storage, t.dir, t.obj)
	}
	return nil
}
