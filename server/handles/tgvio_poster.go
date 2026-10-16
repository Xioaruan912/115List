package handles

import (
	"strconv"

	"errors"
	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"io"
	"net/http"
	"strings"

	"github.com/OpenListTeam/OpenList/v4/cmd/flags"
	"github.com/OpenListTeam/OpenList/v4/internal/tgvio"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
)

// Posters for films and series, from TMDB (see internal/tgvio/tmdb.go).

type posterOut struct {
	Kind     string  `json:"kind"`
	ID       int     `json:"id"`
	Title    string  `json:"title"`
	Original string  `json:"original,omitempty"`
	Year     int     `json:"year,omitempty"`
	Poster   string  `json:"poster,omitempty"`
	Backdrop string  `json:"backdrop,omitempty"`
	Overview string  `json:"overview,omitempty"`
	Rating   float64 `json:"rating,omitempty"`
	Manual   bool    `json:"manual,omitempty"`
	Season   int     `json:"season,omitempty"`
}

func posterURL(size, file string) string {
	if file == "" {
		return ""
	}
	return "/tgvio/poster/" + size + "/" + strings.TrimPrefix(file, "/")
}

func toPosterOut(p *tgvio.Poster) *posterOut {
	if p == nil || p.None {
		return nil
	}
	return &posterOut{Kind: p.Kind, ID: p.ID, Title: p.Title, Original: p.Original, Year: p.Year,
		Poster: posterURL("w342", p.Poster), Backdrop: posterURL("w1280", p.Backdrop), Overview: p.Overview, Rating: p.Rating, Manual: p.Manual, Season: p.Season}
}

func posters() *tgvio.TMDB { return tgvio.Posters(flags.DataDir) }

type postersReq struct {
	Dir   string   `json:"dir"` // the folder the names are in, as the user sees it
	Names []string `json:"names"`
}

// TgvioPosters: POST /api/tgvio/posters {names}
// Known names answer at once; unknown ones are looked up in the background and
// counted in "pending", so the page asks again a little later.
func TgvioPosters(c *gin.Context) {
	var req postersReq
	if err := c.ShouldBindJSON(&req); err != nil || len(req.Names) > 2000 {
		common.ErrorStrResp(c, "give up to 2000 names", 400)
		return
	}
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	dir, err := user.JoinPath(req.Dir)
	if err != nil {
		common.ErrorResp(c, err, 403)
		return
	}
	found, pending := posters().Lookup(dir, req.Names)
	items := make(map[string]*posterOut, len(found))
	for name, p := range found {
		if out := toPosterOut(p); out != nil {
			items[name] = out
		}
	}
	cfg := posters().Config()
	common.SuccessResp(c, gin.H{"items": items, "pending": pending, "enabled": posters().Enabled() && cfg.Enabled, "blur": cfg.Blur})
}

type posterSearchReq struct {
	Query string `json:"query"`
	Year  int    `json:"year"`
}

// TgvioPosterSearch: POST /api/tgvio/posters/search {query, year}
func TgvioPosterSearch(c *gin.Context) {
	var req posterSearchReq
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Query) == "" {
		common.ErrorStrResp(c, "query is required", 400)
		return
	}
	query, year, _, _ := tgvio.CleanName(req.Query)
	if query == "" {
		query = strings.TrimSpace(req.Query)
	}
	if req.Year > 0 {
		year = req.Year
	}
	results, err := posters().Search(c.Request.Context(), query, year)
	if err != nil {
		common.ErrorResp(c, err, 502)
		return
	}
	out := []*posterOut{}
	for _, p := range results {
		if o := toPosterOut(p); o != nil && o.Poster != "" {
			out = append(out, o)
		}
		if len(out) == 18 {
			break
		}
	}
	common.SuccessResp(c, gin.H{"query": query, "results": out})
}

type posterSetReq struct {
	Name   string `json:"name"`
	Kind   string `json:"kind"`
	ID     int    `json:"id"`
	Season int    `json:"season"`
	None   bool   `json:"none"`
}

// TgvioPosterSet: POST /api/tgvio/posters/set {name, kind, id} or {name, none: true}
func TgvioPosterSet(c *gin.Context) {
	var req posterSetReq
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Name) == "" {
		common.ErrorStrResp(c, "name is required", 400)
		return
	}
	if req.None {
		posters().Set(req.Name, &tgvio.Poster{None: true})
		common.SuccessResp(c, gin.H{"item": nil})
		return
	}
	if req.Kind != "movie" && req.Kind != "tv" || req.ID <= 0 {
		common.ErrorStrResp(c, "kind must be movie or tv, with an id", 400)
		return
	}
	p, err := posters().Details(c.Request.Context(), req.Kind, req.ID)
	if err != nil {
		common.ErrorResp(c, err, 502)
		return
	}
	if req.Kind == "tv" && req.Season > 0 {
		posters().ApplySeason(c.Request.Context(), p, req.Season)
	}
	posters().Set(req.Name, p)
	common.SuccessResp(c, gin.H{"item": toPosterOut(p)})
}

// TgvioPosterSeasons: GET /api/tgvio/posters/seasons?id= (a TMDB series id)
func TgvioPosterSeasons(c *gin.Context) {
	id, err := strconv.Atoi(c.Query("id"))
	if err != nil || id <= 0 {
		common.ErrorStrResp(c, "id is required", 400)
		return
	}
	seasons, err := posters().Seasons(c.Request.Context(), id)
	if err != nil {
		common.ErrorResp(c, err, 502)
		return
	}
	for i := range seasons {
		seasons[i].Poster = posterURL("w342", seasons[i].Poster)
	}
	common.SuccessResp(c, seasons)
}

// TgvioPosterImage: GET /tgvio/poster/:size/:file
// Images never change for a file name, so caches may keep them for a year.
func TgvioPosterImage(c *gin.Context) {
	path, err := posters().Image(c.Request.Context(), c.Param("size"), c.Param("file"))
	if err != nil {
		c.Header("Cache-Control", "no-store")
		c.Status(http.StatusNotFound)
		return
	}
	c.Header("Cache-Control", "public, max-age=31536000, immutable")
	c.File(path)
}

// ---------------------------------------------------------------- admin settings

func posterSettings() gin.H {
	p := posters()
	return gin.H{"config": p.Config(), "token_set": p.Enabled(), "token_hint": p.TokenHint(), "stats": p.Stats()}
}

type posterSettingsReq struct {
	Config *tgvio.PosterConfig `json:"config"`
	Token  *string             `json:"token"`
}

// TgvioPosterSettings: GET/POST /api/admin/tgvio/posters
// The token is write-only: it is never sent back, only its last four characters.
func TgvioPosterSettings(c *gin.Context) {
	if c.Request.Method == http.MethodPost {
		var req posterSettingsReq
		if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
			common.ErrorResp(c, err, 400)
			return
		}
		if req.Token != nil {
			if err := posters().SetToken(*req.Token); err != nil {
				common.ErrorResp(c, err, 500)
				return
			}
		}
		if req.Config != nil {
			if err := posters().SetConfig(*req.Config); err != nil {
				common.ErrorResp(c, err, 400)
				return
			}
		}
	}
	common.SuccessResp(c, posterSettings())
}

// TgvioPosterTest: POST /api/admin/tgvio/posters/test
func TgvioPosterTest(c *gin.Context) {
	if err := posters().Test(c.Request.Context()); err != nil {
		common.ErrorResp(c, err, 502)
		return
	}
	common.SuccessResp(c, gin.H{"ok": true})
}

type posterResetReq struct {
	Scope string `json:"scope"`
}

// TgvioPosterReset: POST /api/admin/tgvio/posters/reset {scope: none|auto|images}
func TgvioPosterReset(c *gin.Context) {
	var req posterResetReq
	if err := c.ShouldBindJSON(&req); err != nil || (req.Scope != "none" && req.Scope != "auto" && req.Scope != "images") {
		common.ErrorStrResp(c, "scope must be none, auto or images", 400)
		return
	}
	n := posters().Reset(req.Scope)
	common.SuccessResp(c, gin.H{"cleared": n, "settings": posterSettings()})
}
