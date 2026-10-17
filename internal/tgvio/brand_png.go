package tgvio

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"math"
	"strconv"
	"sync"

	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/gobold"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/font/sfnt"
	"golang.org/x/image/math/fixed"
)

// The site mark as PNG, for the home-screen icons a manifest and iOS need (SVG
// will not do there). Same look as MarkSVG: the title's first letter on the
// accent. "Any" icons are rounded; maskable and Apple ones fill the square
// (the system cuts the shape), the letter kept inside the safe zone. A letter
// the bundled font lacks (a CJK title) leaves the plain colour.

var (
	markAccent = color.RGBA{0xc4, 0xec, 0x5c, 0xff}
	markInk    = color.RGBA{0x11, 0x14, 0x0b, 0xff}
	markCache  sync.Map // "title|size|full" -> []byte
	markFont   *opentype.Font
	markOnce   sync.Once
)

// MarkPNG draws the mark at size×size; full fills the square for maskable and Apple icons.
func MarkPNG(title string, size int, full bool) []byte {
	key := title + "|" + strconv.Itoa(size) + "|" + boolKey(full)
	if v, ok := markCache.Load(key); ok {
		return v.([]byte)
	}
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	radius := 0.0
	if !full {
		radius = float64(size) * 120 / 512
	}
	paintRounded(img, markAccent, radius)
	scale := 0.58
	if full {
		scale = 0.46 // inside the maskable safe zone
	}
	drawLetter(img, MarkLetter(title), float64(size)*scale)
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	out := buf.Bytes()
	markCache.Store(key, out)
	return out
}

// paintRounded fills a rounded square, antialiased at the corners.
func paintRounded(img *image.RGBA, c color.RGBA, radius float64) {
	n := img.Bounds().Dx()
	for y := 0; y < n; y++ {
		for x := 0; x < n; x++ {
			cover := 1.0
			if radius > 0 {
				cx, cy := float64(x)+0.5, float64(y)+0.5
				dx := math.Max(math.Max(radius-cx, cx-(float64(n)-radius)), 0)
				dy := math.Max(math.Max(radius-cy, cy-(float64(n)-radius)), 0)
				if dx > 0 && dy > 0 {
					cover = math.Min(1, math.Max(0, radius-math.Hypot(dx, dy)+0.5))
				}
			}
			if cover > 0 {
				img.SetRGBA(x, y, color.RGBA{uint8(float64(c.R) * cover), uint8(float64(c.G) * cover), uint8(float64(c.B) * cover), uint8(255 * cover)})
			}
		}
	}
}

func drawLetter(img *image.RGBA, letter string, size float64) {
	markOnce.Do(func() { markFont, _ = opentype.Parse(gobold.TTF) })
	if markFont == nil {
		return
	}
	var buf sfnt.Buffer
	for _, r := range letter {
		if idx, err := markFont.GlyphIndex(&buf, r); err != nil || idx == 0 {
			return // not in the font: the colour alone
		}
	}
	face, err := opentype.NewFace(markFont, &opentype.FaceOptions{Size: size, DPI: 72, Hinting: font.HintingNone})
	if err != nil {
		return
	}
	defer face.Close()
	d := &font.Drawer{Dst: img, Src: image.NewUniform(markInk), Face: face}
	bounds, _ := d.BoundString(letter)
	n := fixed.I(img.Bounds().Dx())
	w, h := bounds.Max.X-bounds.Min.X, bounds.Max.Y-bounds.Min.Y
	d.Dot = fixed.Point26_6{X: (n-w)/2 - bounds.Min.X, Y: (n-h)/2 - bounds.Min.Y}
	d.DrawString(letter)
}

func boolKey(b bool) string {
	if b {
		return "1"
	}
	return "0"
}
