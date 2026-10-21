package tgvio

import (
	"strings"
	"testing"
)

func TestMark(t *testing.T) {
	if !IsStockLogo("https://res.oplist.org/logo/logo.svg") || !IsStockLogo("") || IsStockLogo("https://example.com/me.png") {
		t.Fatal("stock logo detection")
	}
	for title, want := range map[string]string{"PPEE": "P", "ppee": "P", "": "O", "  片库": "片", "<x>": "&lt;"} {
		if got := MarkLetter(title); title == "<x>" {
			if !strings.Contains(MarkSVG(title), ">&lt;</text>") {
				t.Fatalf("not escaped: %s", MarkSVG(title))
			}
		} else if got != want {
			t.Fatalf("%q: %q, want %q", title, got, want)
		}
	}
}
