package _115

import (
	"testing"
	"time"
)

func TestLinkExpiration(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	cases := []struct {
		name string
		url  string
		want time.Duration
	}{
		{"stamped ten minutes ahead keeps a margin", "https://cdn.example/f?s=1&t=1800000600", 8 * time.Minute},
		{"long-lived link is capped", "https://cdn.example/f?t=1800003600", 15 * time.Minute},
		{"link about to expire is not cached", "https://cdn.example/f?t=1800000060", 0},
		{"link without a stamp is not cached", "https://cdn.example/f?s=1", 0},
		{"malformed stamp is not cached", "https://cdn.example/f?t=soon", 0},
	}
	for _, c := range cases {
		got := linkExpiration(c.url, now)
		if c.want == 0 {
			if got != nil {
				t.Errorf("%s: got %v, want no caching", c.name, *got)
			}
			continue
		}
		if got == nil || *got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}
