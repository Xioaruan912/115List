package _115

import (
	"net/url"
	"testing"
)

func TestParseMaster(t *testing.T) {
	base, _ := url.Parse("https://115.com/api/video/m3u8/abc.m3u8")
	body := "#EXTM3U\n" +
		"#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=7500000,RESOLUTION=3840x2160,AUDIO=\"Audio-Group\",NAME=\"BD\"\n" +
		"https://cpats01.115.com/x/abc_BD.m3u8?u=1&s=2\n" +
		"#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=3000000,RESOLUTION=1920x1080,AUDIO=\"Audio-Group\",NAME=\"UD\"\n" +
		"/x/abc_UD.m3u8\n"
	qualities, variants := parseMaster(body, base)
	if len(qualities) != 2 || qualities[0].ID != "BD" || qualities[0].Name != "4K" || qualities[1].Name != "1080P" || qualities[1].Height != 1080 {
		t.Fatalf("qualities: %+v", qualities)
	}
	if variants["UD"] != "https://115.com/x/abc_UD.m3u8" || variants["BD"] != "https://cpats01.115.com/x/abc_BD.m3u8?u=1&s=2" {
		t.Fatalf("variants: %v", variants)
	}
}

func TestParseVariant(t *testing.T) {
	base, _ := url.Parse("https://cpats01.115.com/a/b/abc_UD.m3u8?u=1")
	body := "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:11\n#EXT-X-MEDIA-SEQUENCE:0\n" +
		"#EXTINF:10.080000,\n/k1/abc-00001.ts?u=1&se=u,ua\n" +
		"#EXTINF:4.5,\n/k2/abc-00002.ts?u=1\n#EXT-X-ENDLIST\n"
	playlist := parseVariant(body, base)
	if playlist.TargetDuration != 11 || len(playlist.Segments) != 2 {
		t.Fatalf("playlist: %+v", playlist)
	}
	if playlist.Segments[0].URL != "https://cpats01.115.com/k1/abc-00001.ts?u=1&se=u,ua" || playlist.Segments[1].Duration != 4.5 {
		t.Fatalf("segments: %+v", playlist.Segments)
	}
}
