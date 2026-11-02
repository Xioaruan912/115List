package handles

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/OpenListTeam/OpenList/v4/cmd/flags"
	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
)

func undoTestFolder(t *testing.T) (context.Context, string) {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "team", "a", "into"), 0o700); err != nil {
		t.Fatal(err)
	}
	oldDir := flags.DataDir
	flags.DataDir = t.TempDir()
	t.Cleanup(func() { flags.DataDir = oldDir })
	op.Cache = op.NewCacheManager()
	user := setupBackslashTraversalTest(t, root, 1<<3|1<<4|1<<5|1<<7)
	ctx := context.WithValue(context.Background(), conf.UserKey, user)
	ctx = context.WithValue(ctx, conf.SkipHookKey, struct{}{})
	return ctx, filepath.Join(root, "team", "a")
}

func writeUndoFile(t *testing.T, path, data string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(data), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestUndoPlacePreflightsOriginalName(t *testing.T) {
	ctx, dir := undoTestFolder(t)
	writeUndoFile(t, filepath.Join(dir, "into", "new.mkv"), "movie")
	writeUndoFile(t, filepath.Join(dir, "old.mkv"), "keep")
	change := journalOp{Op: "place", Dir: "/team/a", Old: "old.mkv", New: "new.mkv", Into: "into"}
	if err := undoOp(ctx, change); err == nil {
		t.Fatal("original name conflict must fail")
	}
	if _, err := os.Stat(filepath.Join(dir, "into", "new.mkv")); err != nil {
		t.Fatal("conflict moved the movie out before detecting its final destination")
	}
	if got, _ := os.ReadFile(filepath.Join(dir, "old.mkv")); string(got) != "keep" {
		t.Fatal("conflicting file was overwritten")
	}
}

func TestUndoPlaceResumesAfterMoveAndAfterRename(t *testing.T) {
	ctx, dir := undoTestFolder(t)
	// A previous attempt moved it out, but stopped before renaming it.
	writeUndoFile(t, filepath.Join(dir, "new.mkv"), "movie")
	change := journalOp{Op: "place", Dir: "/team/a", Old: "old.mkv", New: "new.mkv", Into: "into"}
	if err := undoOp(ctx, change); err != nil {
		t.Fatalf("resume after move: %v", err)
	}
	if got, _ := os.ReadFile(filepath.Join(dir, "old.mkv")); string(got) != "movie" {
		t.Fatal("original file was not restored")
	}
	// A crash may also happen after renaming but before the journal is saved.
	if err := undoOp(ctx, change); err != nil {
		t.Fatalf("repeat completed operation: %v", err)
	}
}

func TestUndoUnwrapResumesWithoutOverwriting(t *testing.T) {
	ctx, dir := undoTestFolder(t)
	writeUndoFile(t, filepath.Join(dir, "into", "one.mkv"), "first")
	writeUndoFile(t, filepath.Join(dir, "two.mkv"), "second")
	change := journalOp{Op: "unwrap", Dir: "/team/a", Old: "into", Moved: []string{"one.mkv", "two.mkv"}}
	if err := undoOp(ctx, change); err != nil {
		t.Fatalf("resume halfway through restoring a wrapper: %v", err)
	}
	if got, _ := os.ReadFile(filepath.Join(dir, "into", "two.mkv")); string(got) != "second" {
		t.Fatal("second file was not restored")
	}
	writeUndoFile(t, filepath.Join(dir, "one.mkv"), "conflict")
	if err := undoOp(ctx, change); err == nil {
		t.Fatal("both source and destination exist: must report conflict")
	}
	if got, _ := os.ReadFile(filepath.Join(dir, "into", "one.mkv")); string(got) != "first" {
		t.Fatal("restored file was overwritten")
	}
}

func TestUndoNestedFolderResumesAfterMove(t *testing.T) {
	ctx, dir := undoTestFolder(t)
	if err := os.Mkdir(filepath.Join(dir, "season-new"), 0o700); err != nil {
		t.Fatal(err)
	}
	writeUndoFile(t, filepath.Join(dir, "season-new", "episode.mkv"), "movie")
	change := journalOp{Op: "folder", Dir: "/team/a", Old: "season-old", New: "into/season-new"}
	if err := undoOp(ctx, change); err != nil {
		t.Fatalf("resume folder already moved out of its box: %v", err)
	}
	if got, _ := os.ReadFile(filepath.Join(dir, "season-old", "episode.mkv")); string(got) != "movie" {
		t.Fatal("season folder was not restored")
	}
}
