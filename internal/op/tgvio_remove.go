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
	// A drive can report a batch as done and still keep some of it (115 did, for
	// 2 of 148 files). Re-list each folder from the drive and remove what is left
	// one by one, so a caller is never told a file is gone while it is not.
	byDir := map[string][]model.Obj{}
	for _, t := range targets {
		byDir[t.dir] = append(byDir[t.dir], t.obj)
	}
	for dir, wanted := range byDir {
		present, err := List(ctx, storage, dir, model.ListArgs{Refresh: true})
		if err != nil {
			if errs.IsObjectNotFound(err) {
				continue
			}
			return errors.WithMessage(err, "failed to verify batch removal")
		}
		for _, obj := range wanted {
			if !containsObj(present, obj) {
				continue
			}
			if err := Remove(ctx, storage, stdpath.Join(dir, obj.GetName())); err != nil {
				return err
			}
		}
	}
	return nil
}

func containsObj(objs []model.Obj, target model.Obj) bool {
	for _, obj := range objs {
		if target.GetID() != "" && obj.GetID() == target.GetID() {
			return true
		}
		if target.GetID() == "" && obj.GetName() == target.GetName() {
			return true
		}
	}
	return false
}
