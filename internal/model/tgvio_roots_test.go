package model

import (
	"errors"
	"testing"

	"github.com/OpenListTeam/OpenList/v4/internal/errs"
)

func TestRoots(t *testing.T) {
	one := &User{BasePath: "/115/读书"}
	if one.MultiRoot() {
		t.Fatal("one root is not multi")
	}
	if got, _ := one.JoinPath("/a.pdf"); got != "/115/读书/a.pdf" {
		t.Fatalf("single JoinPath = %q", got)
	}
	if got, ok := one.ShowPath("/115/读书/x/a.pdf"); !ok || got != "/x/a.pdf" {
		t.Fatalf("single ShowPath = %q %v", got, ok)
	}
	u := &User{BasePath: " /115/读书 \n/115/我要看/\n\n/115/读书"}
	if CleanBasePath(u.BasePath) != "/115/读书\n/115/我要看" || !u.MultiRoot() {
		t.Fatalf("clean = %q", CleanBasePath(u.BasePath))
	}
	if _, err := u.JoinPath("/"); err == nil {
		t.Fatal("/ of several roots has no real path")
	}
	if got, err := u.JoinPath("/我要看/爱情公寓"); err != nil || got != "/115/我要看/爱情公寓" {
		t.Fatalf("JoinPath = %q %v", got, err)
	}
	if got, err := u.JoinPath("/读书"); err != nil || got != "/115/读书" {
		t.Fatalf("JoinPath root = %q %v", got, err)
	}
	if _, err := u.JoinPath("/Pron/x"); err == nil {
		t.Fatal("outside the roots must fail")
	}
	if _, err := u.JoinPath("/我要看/../../Pron"); err == nil {
		t.Fatal("escaping a root must fail")
	}
	if got, ok := u.ShowPath("/115/我要看/爱情公寓"); !ok || got != "/我要看/爱情公寓" {
		t.Fatalf("ShowPath = %q %v", got, ok)
	}
	if u.Sees("/115/Pron/a.mp4") {
		t.Fatal("must not see other folders")
	}
	if CleanBasePath("/a\n/") != "/" {
		t.Fatal("/ swallows the rest")
	}
}

func TestAmbiguousRootsFailClosed(t *testing.T) {
	u := &User{BasePath: "/disk-a/Movies\n/disk-b/Movies"}
	if got, err := u.JoinPath("/Movies/demo.mkv"); !errors.Is(err, errs.PermissionDenied) || got != "" {
		t.Errorf("ambiguous JoinPath = %q, %v; want permission denied", got, err)
	}
	for _, real := range []string{"/disk-a/Movies/demo.mkv", "/disk-b/Movies/demo.mkv"} {
		if got, ok := u.ShowPath(real); ok || got != "" {
			t.Errorf("ambiguous ShowPath(%q) = %q, %v", real, got, ok)
		}
		if u.Sees(real) {
			t.Errorf("ambiguous roots must not expose %q", real)
		}
	}
}

func TestUniqueRootsRoundTrip(t *testing.T) {
	u := &User{BasePath: "/disk-a/Movies\n/disk-b/Shows"}
	for _, tt := range []struct{ real, shown string }{
		{"/disk-a/Movies/demo.mkv", "/Movies/demo.mkv"},
		{"/disk-b/Shows/demo.mkv", "/Shows/demo.mkv"},
	} {
		got, ok := u.ShowPath(tt.real)
		if !ok || got != tt.shown {
			t.Fatalf("ShowPath(%q) = %q, %v", tt.real, got, ok)
		}
		if real, err := u.JoinPath(got); err != nil || real != tt.real {
			t.Errorf("JoinPath(%q) = %q, %v; want %q", got, real, err, tt.real)
		}
	}
}
