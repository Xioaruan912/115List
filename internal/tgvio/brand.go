package tgvio

import (
	"html"
	"strings"
	"unicode"
	"unicode/utf8"
)

// MarkPath serves the site mark: the first letter of the site title on the
// front end's accent colour. It stands in for OpenList's stock logo, which is
// what a fresh install (or one never customised) has in the favicon and logo settings.
const MarkPath = "/tgvio/mark.svg"

// IsStockLogo reports whether a favicon/logo setting is still OpenList's default.
func IsStockLogo(url string) bool {
	url = strings.TrimSpace(url)
	return url == "" || strings.Contains(url, "res.oplist.org/logo/") || strings.Contains(url, "cdn.oplist.org/gh/OpenListTeam/Logo")
}

// MarkLetter is the first letter of the title, upper-cased ("O" when empty).
func MarkLetter(title string) string {
	title = strings.TrimSpace(title)
	r, _ := utf8.DecodeRuneInString(title)
	if r == utf8.RuneError || r == 0 {
		return "O"
	}
	return string(unicode.ToUpper(r))
}

// MarkSVG draws the mark: rounded square #c4ec5c, letter #11140b.
func MarkSVG(title string) string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
		`<rect width="512" height="512" rx="120" fill="#c4ec5c"/>` +
		`<text x="256" y="262" text-anchor="middle" dominant-baseline="central" fill="#11140b" ` +
		`font-family="Geist, Geist Variable, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif" ` +
		`font-weight="700" font-size="300">` + html.EscapeString(MarkLetter(title)) + `</text></svg>`
}
