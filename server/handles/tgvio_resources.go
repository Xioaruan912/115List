package handles

import (
	"context"
	"time"

	"github.com/OpenListTeam/OpenList/v4/cmd/flags"
	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/tgvio"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
)

// TGVIO: resource search (internal/tgvio/resources.go). The browser opens the
// sites; the server keeps the list and checks the sites answer.

func resourceSites() *tgvio.Resources { return tgvio.ResourceSites(flags.DataDir) }

type resourceSiteView struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Search string `json:"search"`
	Reader string `json:"reader,omitempty"`
}

// TgvioResources: GET /api/tgvio/resources — the enabled sites, when the feature is on.
func TgvioResources(c *gin.Context) {
	cfg := resourceSites().Config()
	sites := []resourceSiteView{}
	if cfg.Enabled {
		for _, p := range resourceSites().Providers() {
			sites = append(sites, resourceSiteView{ID: p.ID, Name: p.Name, Search: p.Search, Reader: p.Reader})
		}
	}
	common.SuccessResp(c, gin.H{"enabled": cfg.Enabled && len(sites) > 0, "sites": sites, "folder": showFolder(c, cfg.Folder), "auto_organize": !cfg.ManualOrganize})
}

// TgvioResourcesAdmin: GET/POST /api/admin/tgvio/resources {enabled, sites}
func TgvioResourcesAdmin(c *gin.Context) {
	if c.Request.Method == "POST" {
		var req tgvio.ResourceConfig
		if err := c.ShouldBindJSON(&req); err != nil {
			common.ErrorResp(c, err, 400)
			return
		}
		if _, err := resourceSites().Save(req); err != nil {
			common.ErrorResp(c, err, 400)
			return
		}
	}
	common.SuccessResp(c, gin.H{"config": resourceSites().Config(), "default": tgvio.DefaultResources().Sites})
}

// TgvioResourcesProbe: POST /api/admin/tgvio/resources/probe — how each site answers the server.
func TgvioResourcesProbe(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()
	common.SuccessResp(c, gin.H{"results": resourceSites().ProbeAll(ctx)})
}

type resourceReadReq struct {
	Site  string   `json:"site"`
	Query string   `json:"q"`
	ID    string   `json:"id"`
	Seeds []string `json:"seeds"`
}

// readerFor binds the request and finds the site's server-side reader.
func readerFor(c *gin.Context) (tgvio.Reader, *resourceReadReq, bool) {
	var req resourceReadReq
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return nil, nil, false
	}
	reader, err := resourceSites().ReaderFor(req.Site)
	if err != nil {
		common.ErrorResp(c, err, 400)
		return nil, nil, false
	}
	return reader, &req, true
}

// TgvioResourceTitles: POST /api/tgvio/resources/titles {site, q}
func TgvioResourceTitles(c *gin.Context) {
	reader, req, ok := readerFor(c)
	if !ok {
		return
	}
	titles, err := reader.Titles(c.Request.Context(), req.Query)
	if err != nil {
		common.ErrorResp(c, err, 502)
		return
	}
	common.SuccessResp(c, gin.H{"items": titles})
}

// TgvioResourceSeeds: POST /api/tgvio/resources/seeds {site, id}
func TgvioResourceSeeds(c *gin.Context) {
	reader, req, ok := readerFor(c)
	if !ok {
		return
	}
	seeds, err := reader.Seeds(c.Request.Context(), req.ID)
	if err != nil {
		common.ErrorResp(c, err, 502)
		return
	}
	common.SuccessResp(c, gin.H{"items": seeds})
}

// TgvioResourceMagnets: POST /api/tgvio/resources/magnets {site, seeds} — the magnets of the picked seeds.
func TgvioResourceMagnets(c *gin.Context) {
	reader, req, ok := readerFor(c)
	if !ok {
		return
	}
	if len(req.Seeds) == 0 || len(req.Seeds) > 60 {
		common.ErrorStrResp(c, "pick between 1 and 60 seeds", 400)
		return
	}
	type found struct {
		Seed  string `json:"seed"`
		URL   string `json:"url,omitempty"`
		Error string `json:"error,omitempty"`
	}
	out := make([]found, 0, len(req.Seeds))
	for _, seed := range req.Seeds {
		magnet, err := reader.Magnet(c.Request.Context(), seed)
		if err != nil {
			out = append(out, found{Seed: seed, Error: err.Error()})
			continue
		}
		out = append(out, found{Seed: seed, URL: magnet})
	}
	common.SuccessResp(c, gin.H{"items": out})
}

// showFolder is the default download folder as this user sees it (their root
// may be below it); empty when it is outside what they can see.
func showFolder(c *gin.Context, folder string) string {
	if folder == "" {
		return ""
	}
	user, ok := c.Request.Context().Value(conf.UserKey).(*model.User)
	if !ok {
		return ""
	}
	shown, ok := user.ShowPath(folder)
	if !ok {
		return ""
	}
	return shown
}
