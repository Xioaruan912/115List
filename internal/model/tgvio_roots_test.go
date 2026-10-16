package model

import "testing"

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
