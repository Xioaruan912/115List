package static

import (
	"strings"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/setting"
	"github.com/OpenListTeam/OpenList/v4/internal/tgvio"
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

// markURL is the site mark under the configured base path.
func markURL() string {
	base := getSiteConfig().BasePath
	if base == "/" {
		base = ""
	}
	return base + tgvio.MarkPath
}

// tgvioBrand swaps OpenList's stock favicon and logo for the site mark.
func tgvioBrand(favicon, logo string) (string, string) {
	if tgvio.IsStockLogo(favicon) {
		favicon = markURL()
	}
	if tgvio.IsStockLogo(logo) {
		logo = markURL()
	}
	return favicon, logo
}

// Mark serves the site mark, drawn from the current site title.
func Mark(c *gin.Context) {
	c.Header("Cache-Control", "public, max-age=3600")
	c.Data(200, "image/svg+xml; charset=utf-8", []byte(tgvio.MarkSVG(setting.GetStr(conf.SiteTitle))))
}
