package static

import (
	"strings"

	"github.com/gin-gonic/gin"
)

// TGVIO: the site sits behind a caching CDN, and every deploy replaces the hashed
// front-end assets. Two rules keep a deploy from serving a broken page:
//   - page HTML is never stored by a cache (it names the current asset hashes);
//   - a missing asset is a plain 404, not index.html under a 180-day cache header
//     (gin hands missing static files to the catch-all route).

var staticFolders = []string{"assets", "images", "streamer", "static"}

func isStaticAsset(path string) bool {
	for _, folder := range staticFolders {
		if strings.HasPrefix(path, "/"+folder+"/") {
			return true
		}
	}
	return false
}

// serveMissingAsset answers a missing static file and reports whether it did.
func serveMissingAsset(c *gin.Context) bool {
	if !isStaticAsset(c.Request.URL.Path) {
		return false
	}
	c.Header("Cache-Control", "no-store")
	c.String(404, "not found")
	return true
}

// NoStore marks API responses as uncacheable unless a handler said otherwise.
func NoStore(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Next()
}
