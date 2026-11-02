package handles

import (
	"path"
	"testing"

	"github.com/OpenListTeam/OpenList/v4/internal/errs"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
)

func fakeResolveMeta(metas map[string]*model.Meta) func(string) (*model.Meta, error) {
	return func(p string) (*model.Meta, error) {
		for {
			if meta, ok := metas[p]; ok {
				return meta, nil
			}
			if p == "/" {
				return nil, errs.MetaNotFound
			}
			p = path.Dir(p)
		}
	}
}

func TestIsSearchNodeAccessible(t *testing.T) {
	tests := []struct {
		name         string
		basePath     string
		metas        map[string]*model.Meta
		node         model.SearchNode
		want         bool
		wantMetaPath string
	}{
		{
			name:         "restricted directory",
			basePath:     "/",
			metas:        map[string]*model.Meta{"/private": {Path: "/private", ReadUsers: []uint{1}}},
			node:         model.SearchNode{Parent: "/", Name: "private", IsDir: true},
			want:         false,
			wantMetaPath: "/private",
		},
		{
			name:         "restricted sub directory",
			basePath:     "/",
			metas:        map[string]*model.Meta{"/private": {Path: "/private", ReadUsers: []uint{1}, ReadUsersSub: true}},
			node:         model.SearchNode{Parent: "/private", Name: "sub", IsDir: true},
			want:         false,
			wantMetaPath: "/private/sub",
		},
		{
			name:         "file keeps parent scope",
			basePath:     "/",
			metas:        map[string]*model.Meta{"/private": {Path: "/private", ReadUsers: []uint{1}}},
			node:         model.SearchNode{Parent: "/private", Name: "a.txt", IsDir: false},
			want:         true,
			wantMetaPath: "/private",
		},
		{
			name:         "outside base path",
			basePath:     "/library",
			node:         model.SearchNode{Parent: "/other", Name: "private", IsDir: true},
			want:         false,
			wantMetaPath: "",
		},
		{
			name:         "single root descendant",
			basePath:     "/library",
			node:         model.SearchNode{Parent: "/library/Movies", Name: "demo.mkv"},
			want:         true,
			wantMetaPath: "/library/Movies",
		},
		{
			name:     "single root sibling prefix",
			basePath: "/library",
			node:     model.SearchNode{Parent: "/library-other", Name: "demo.mkv"},
			want:     false,
		},
		{
			name:         "multi root first root",
			basePath:     "/disk-a/Movies\n/disk-b/Shows",
			node:         model.SearchNode{Parent: "/disk-a/Movies", Name: "demo.mkv"},
			want:         true,
			wantMetaPath: "/disk-a/Movies",
		},
		{
			name:         "multi root second descendant",
			basePath:     "/disk-a/Movies\n/disk-b/Shows",
			node:         model.SearchNode{Parent: "/disk-b/Shows/Season 1", Name: "demo.mkv"},
			want:         true,
			wantMetaPath: "/disk-b/Shows/Season 1",
		},
		{
			name:     "multi root sibling prefix",
			basePath: "/disk-a/Movies\n/disk-b/Shows",
			node:     model.SearchNode{Parent: "/disk-b/Shows-other", Name: "demo.mkv"},
			want:     false,
		},
		{
			name:     "multi root outside roots",
			basePath: "/disk-a/Movies\n/disk-b/Shows",
			node:     model.SearchNode{Parent: "/disk-c/Movies", Name: "demo.mkv"},
			want:     false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			user := &model.User{ID: 2, BasePath: tt.basePath}
			resolve := fakeResolveMeta(tt.metas)
			var gotMetaPath string
			spy := func(p string) (*model.Meta, error) {
				gotMetaPath = p
				return resolve(p)
			}
			if got := isSearchNodeAccessible(user, tt.node, "", spy); got != tt.want {
				t.Fatalf("isSearchNodeAccessible() = %v, want %v", got, tt.want)
			}
			if gotMetaPath != tt.wantMetaPath {
				t.Fatalf("meta resolved at %q, want %q", gotMetaPath, tt.wantMetaPath)
			}
		})
	}
}
