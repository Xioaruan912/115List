package handles

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// A clean request must name entries: an empty list would empty the whole bin.
func TestRecycleCleanRefusesMissingOrEmptyIDs(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, body := range []string{`{}`, `{"ids":[]}`, `{"ids":[""]}`, `not json`} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodPost, "/api/admin/tgvio/recycle/clean", strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		TgvioRecycleClean(c)
		if !strings.Contains(w.Body.String(), `"code":400`) {
			t.Errorf("body %s: want a 400, got %s", body, w.Body.String())
		}
	}
}

func TestRecycleListRejectsAnOversizedPage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/admin/tgvio/recycle?limit=5000", nil)
	TgvioRecycleList(c)
	if !strings.Contains(w.Body.String(), `"code":400`) {
		t.Errorf("want a 400, got %s", w.Body.String())
	}
}
