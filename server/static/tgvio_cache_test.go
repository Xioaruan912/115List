package static

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestMissingAssetIsUncached404(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for path, want := range map[string]bool{"/assets/index-old.js": true, "/static/x.css": true, "/115/assets/a.js": false, "/": false} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("GET", path, nil)
		if got := serveMissingAsset(c); got != want {
			t.Fatalf("%s: handled=%v, want %v", path, got, want)
		}
		if want && (w.Code != 404 || w.Header().Get("Cache-Control") != "no-store") {
			t.Fatalf("%s: code %d cache %q", path, w.Code, w.Header().Get("Cache-Control"))
		}
	}
}
