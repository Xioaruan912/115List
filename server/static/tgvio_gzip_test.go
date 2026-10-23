package static

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/gin-gonic/gin"
)

func TestServeGzipped(t *testing.T) {
	gin.SetMode(gin.TestMode)
	js := strings.Repeat("console.log('hello');\n", 200)
	files := fstest.MapFS{"assets/index-abc.js": {Data: []byte(js)}, "assets/tiny.js": {Data: []byte("x")}, "assets/pic.png": {Data: bytes.Repeat([]byte{1}, 4000)}}
	r := gin.New()
	r.Use(func(c *gin.Context) { serveGzipped(c, files) })
	r.GET("/*any", func(c *gin.Context) { c.String(200, "plain") })

	get := func(path, enc string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		if enc != "" {
			req.Header.Set("Accept-Encoding", enc)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	w := get("/assets/index-abc.js", "gzip, br")
	if w.Header().Get("Content-Encoding") != "gzip" || !strings.Contains(w.Header().Get("Content-Type"), "javascript") {
		t.Fatalf("headers: %v", w.Header())
	}
	zr, err := gzip.NewReader(w.Body)
	if err != nil {
		t.Fatal(err)
	}
	out, _ := io.ReadAll(zr)
	if string(out) != js || w.Body.Len() >= len(js) {
		t.Fatalf("body: %d bytes", len(out))
	}
	for _, c := range []struct{ path, enc string }{{"/assets/index-abc.js", ""}, {"/assets/tiny.js", "gzip"}, {"/assets/pic.png", "gzip"}, {"/api/x.js", "gzip"}} {
		if w := get(c.path, c.enc); w.Header().Get("Content-Encoding") != "" || w.Body.String() != "plain" {
			t.Errorf("%s (%s) should be served plain", c.path, c.enc)
		}
	}
}
