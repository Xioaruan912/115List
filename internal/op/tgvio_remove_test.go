package op_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	_ "github.com/OpenListTeam/OpenList/v4/drivers"
	"github.com/OpenListTeam/OpenList/v4/drivers/local"
	"github.com/OpenListTeam/OpenList/v4/internal/driver"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
)

// batchLocal is a Local storage that records batch removals.
type batchLocal struct {
	*local.Local
	batches [][]string
}

func (b *batchLocal) BatchRemove(ctx context.Context, objs []model.Obj) error {
	names := make([]string, 0, len(objs))
	for _, obj := range objs {
		names = append(names, obj.GetName())
		if err := b.Local.Remove(ctx, obj); err != nil {
			return err
		}
	}
	b.batches = append(b.batches, names)
	return nil
}

func localStorage(t *testing.T, mount string) (driver.Driver, string) {
	t.Helper()
	root := t.TempDir()
	for _, rel := range []string{"media/v.mp4", "renditions/a.mp4", "renditions/b.mp4"} {
		path := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(rel), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	addition := `{"root_folder_path":"` + root + `"}`
	if _, err := op.CreateStorage(context.Background(), model.Storage{Driver: "Local", MountPath: mount, Addition: addition}); err != nil {
		t.Fatalf("create storage: %+v", err)
	}
	t.Cleanup(func() {
		if s, err := op.GetStorageByMountPath(mount); err == nil {
			_ = op.DeleteStorageById(context.Background(), s.GetStorage().ID)
		}
	})
	storage, err := op.GetStorageByMountPath(mount)
	if err != nil {
		t.Fatal(err)
	}
	return storage, root
}

func TestRemoveManyUsesOneBatchAcrossFolders(t *testing.T) {
	storage, root := localStorage(t, "/tgvio-batch")
	batch := &batchLocal{Local: storage.(*local.Local)}
	paths := []string{"/renditions/a.mp4", "/renditions/b.mp4", "/media/v.mp4", "/media/gone.mp4"}
	if err := op.RemoveMany(context.Background(), batch, paths); err != nil {
		t.Fatalf("RemoveMany: %+v", err)
	}
	if len(batch.batches) != 1 || len(batch.batches[0]) != 3 {
		t.Fatalf("want one batch of the three existing files, got %v", batch.batches)
	}
	for _, rel := range []string{"media/v.mp4", "renditions/a.mp4", "renditions/b.mp4"} {
		if _, err := os.Stat(filepath.Join(root, rel)); !os.IsNotExist(err) {
			t.Errorf("%s still exists", rel)
		}
	}
}

func TestRemoveManyFallsBackToSingleRemovals(t *testing.T) {
	storage, root := localStorage(t, "/tgvio-single")
	if err := op.RemoveMany(context.Background(), storage, []string{"/renditions/a.mp4", "/media/v.mp4"}); err != nil {
		t.Fatalf("RemoveMany: %+v", err)
	}
	for _, rel := range []string{"media/v.mp4", "renditions/a.mp4"} {
		if _, err := os.Stat(filepath.Join(root, rel)); !os.IsNotExist(err) {
			t.Errorf("%s still exists", rel)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "renditions/b.mp4")); err != nil {
		t.Errorf("an unrelated file was removed: %v", err)
	}
}
