package model

import (
	stdpath "path"
	"strings"

	"github.com/OpenListTeam/OpenList/v4/internal/errs"
	"github.com/OpenListTeam/OpenList/v4/pkg/utils"
)

// TGVIO: a user may have several root folders, one per line of BasePath.
//
// With one root nothing changes. With several, the user's "/" is a virtual
// folder holding one entry per root, named after the root's last segment, and
// "/<name>/rest" is "<root>/rest". JoinPath is where every request path turns
// into a real path, so permissions, uploads and previews follow on their own.

// ErrVirtualRoot is JoinPath's answer for "/" of a user with several roots:
// there is no real path behind it; callers that list it build it from Roots.
var ErrVirtualRoot = errs.PermissionDenied

// CleanBasePath normalises one root per line, without duplicates.
func CleanBasePath(raw string) string {
	var roots []string
	seen := map[string]bool{}
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		root := utils.FixAndCleanPath(line)
		if !seen[root] {
			seen[root] = true
			roots = append(roots, root)
		}
	}
	if len(roots) == 0 {
		return "/"
	}
	for _, root := range roots {
		if root == "/" {
			return "/" // the whole drive includes every other root
		}
	}
	return strings.Join(roots, "\n")
}

// Roots lists the user's root folders (real paths).
func (u *User) Roots() []string {
	return strings.Split(CleanBasePath(u.BasePath), "\n")
}

// MultiRoot reports whether "/" is a virtual folder of several roots.
func (u *User) MultiRoot() bool { return len(u.Roots()) > 1 }

// RootName is the entry a root shows as in the virtual "/".
func RootName(root string) string {
	if root == "/" {
		return "/"
	}
	return stdpath.Base(root)
}

func (u *User) joinMulti(reqPath string) (string, error) {
	isRelative := strings.Contains(reqPath, "..")
	clean := utils.FixAndCleanPath(reqPath)
	if isRelative && !strings.Contains(clean, "..") {
		return "", errs.RelativePath
	}
	if clean == "/" {
		return "", ErrVirtualRoot
	}
	first, rest, _ := strings.Cut(strings.TrimPrefix(clean, "/"), "/")
	for _, root := range u.Roots() {
		if RootName(root) == first {
			return stdpath.Join(root, "/"+rest), nil
		}
	}
	return "", errs.PermissionDenied
}

// ShowPath turns a real path into the path this user sees, if they see it.
func (u *User) ShowPath(real string) (string, bool) {
	real = utils.FixAndCleanPath(real)
	roots := u.Roots()
	for _, root := range roots {
		if !utils.IsSubPath(root, real) {
			continue
		}
		rest := strings.TrimPrefix(real, root)
		if root == "/" {
			rest = real
		}
		if len(roots) == 1 {
			return utils.FixAndCleanPath(rest), true
		}
		return utils.FixAndCleanPath("/" + RootName(root) + "/" + rest), true
	}
	return "", false
}

// Sees reports whether a real path is inside one of the user's roots.
func (u *User) Sees(real string) bool {
	_, ok := u.ShowPath(real)
	return ok
}
