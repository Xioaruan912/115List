package static

import (
	"bytes"
	"compress/gzip"
	"io"
	"io/fs"
	"mime"
	"net/http"
	stdpath "path"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
)

// TGVIO: the front end's hashed assets were sent uncompressed (about 1 MB of
// JavaScript on a first visit, again after every deploy). Text assets are now
// gzipped once, on their first request, and served from memory; a hashed file
// never changes, so its compressed copy never goes stale.

var gzipped sync.Map // "assets/index-abc.js" -> []byte

var compressible = map[string]bool{".js": true, ".css": true, ".svg": true, ".json": true, ".map": true, ".txt": true, ".html": true, ".wasm": true}

// serveGzipped answers a static asset request with its gzipped copy when the
// browser takes gzip; false leaves it to the plain file server.
func serveGzipped(c *gin.Context, files fs.FS) bool {
	if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
		return false
	}
	if !strings.Contains(c.GetHeader("Accept-Encoding"), "gzip") || !isStaticAsset(c.Request.URL.Path) {
		return false
	}
	name := strings.TrimPrefix(stdpath.Clean(c.Request.URL.Path), "/")
	ext := stdpath.Ext(name)
	if !compressible[ext] {
		return false
	}
	body, ok := gzipped.Load(name)
	if !ok {
		f, err := files.Open(name)
		if err != nil {
			return false
		}
		raw, err := io.ReadAll(f)
		_ = f.Close()
		if err != nil || len(raw) < 1024 {
			return false
		}
		var buf bytes.Buffer
		w, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
		_, _ = w.Write(raw)
		_ = w.Close()
		body, _ = gzipped.LoadOrStore(name, buf.Bytes())
	}
	data := body.([]byte)
	kind := mime.TypeByExtension(ext)
	if kind == "" {
		kind = "application/octet-stream"
	}
	c.Header("Content-Type", kind)
	c.Header("Content-Encoding", "gzip")
	c.Header("Vary", "Accept-Encoding")
	c.Header("Cache-Control", "public, max-age=15552000, immutable")
	c.Status(http.StatusOK)
	if c.Request.Method == http.MethodGet {
		_, _ = c.Writer.Write(data)
	}
	c.Abort()
	return true
}
