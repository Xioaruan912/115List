package handles

import (
	"strings"
	"testing"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/tgvio"
)

func TestMediaPlaylist(t *testing.T) {
	got := mediaPlaylist(&tgvio.CloudPlaylist{TargetDuration: 11, Segments: []tgvio.CloudSegment{
		{Duration: 10.08, URL: "https://cdn/a.ts?secret"}, {Duration: 4.5, URL: "https://cdn/b.ts"},
	}})
	want := "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-TARGETDURATION:11\n#EXT-X-MEDIA-SEQUENCE:0\n" +
		"#EXTINF:10.080,\n0.ts\n#EXTINF:4.500,\n1.ts\n#EXT-X-ENDLIST\n"
	if got != want {
		t.Fatalf("playlist:\n%s", got)
	}
	if strings.Contains(got, "cdn") {
		t.Fatal("drive URLs leaked")
	}
}

func TestTickets(t *testing.T) {
	id := issueTicket("/115/a.mp4")
	if len(id) < 20 {
		t.Fatalf("ticket too short: %q", id)
	}
	if ticket, ok := lookupTicket(id); !ok || ticket.path != "/115/a.mp4" {
		t.Fatal("ticket not found")
	}
	if _, ok := lookupTicket("nope"); ok {
		t.Fatal("unknown ticket accepted")
	}
	videoTickets.Lock()
	videoTickets.m[id].expires = time.Now().Add(-time.Second)
	videoTickets.Unlock()
	if _, ok := lookupTicket(id); ok {
		t.Fatal("expired ticket accepted")
	}
}
