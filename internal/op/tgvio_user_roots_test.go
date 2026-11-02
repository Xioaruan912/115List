package op_test

import (
	"strings"
	"testing"

	"github.com/OpenListTeam/OpenList/v4/internal/db"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
)

func TestCreateUserRejectsAmbiguousRoots(t *testing.T) {
	u := &model.User{Username: t.Name(), BasePath: " /disk-a/Movies/ \n/disk-b/Movies "}
	t.Cleanup(func() { db.GetDb().Delete(u) })
	err := op.CreateUser(u)
	if err == nil || !strings.Contains(err.Error(), "根目录名称重复") || !strings.Contains(err.Error(), "Movies") {
		t.Fatalf("CreateUser() = %v; want Chinese duplicate-root error naming Movies", err)
	}
	var count int64
	if err := db.GetDb().Model(&model.User{}).Where("username = ?", u.Username).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("rejected user persisted: count = %d, error = %v", count, err)
	}
}

func TestUpdateUserRejectsAmbiguousRoots(t *testing.T) {
	u := &model.User{Username: t.Name(), BasePath: "/original"}
	if err := op.CreateUser(u); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.GetDb().Delete(u) })
	u.BasePath = "/disk-a/Movies\n/disk-b/Movies"
	err := op.UpdateUser(u)
	if err == nil || !strings.Contains(err.Error(), "根目录名称重复") || !strings.Contains(err.Error(), "Movies") {
		t.Fatalf("UpdateUser() = %v; want Chinese duplicate-root error naming Movies", err)
	}
	stored, err := db.GetUserById(u.ID)
	if err != nil || stored.BasePath != "/original" {
		t.Fatalf("rejected update changed stored roots: user = %+v, error = %v", stored, err)
	}
}

func TestUserRootNormalization(t *testing.T) {
	for _, tt := range []struct{ name, raw, want string }{
		{"unique", " /disk-a/Movies/ \n/disk-b/Shows/\n/disk-a/Movies", "/disk-a/Movies\n/disk-b/Shows"},
		{"same root", "/disk-a/Movies\n/disk-a/Movies/", "/disk-a/Movies"},
		{"whole drive", "/disk-a/Movies\n/disk-b/Movies\n/", "/"},
		{"empty", "\n ", "/"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			u := &model.User{Username: t.Name(), BasePath: tt.raw}
			if err := op.CreateUser(u); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { db.GetDb().Delete(u) })
			if u.BasePath != tt.want {
				t.Fatalf("created BasePath = %q, want %q", u.BasePath, tt.want)
			}
			u.BasePath = tt.raw
			if err := op.UpdateUser(u); err != nil {
				t.Fatal(err)
			}
			stored, err := db.GetUserById(u.ID)
			if err != nil || stored.BasePath != tt.want {
				t.Fatalf("updated user = %+v, error = %v; want BasePath %q", stored, err, tt.want)
			}
		})
	}
}
