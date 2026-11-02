package tgvio

import "testing"

func TestOrdinaryLibraryNotesAreNotJunk(t *testing.T) {
	film := RenameEntry{Name: "电影.mkv", Size: 1 << 30}
	for _, name := range []string{"观影笔记.txt", "说明.txt", "source.url", "review.html", "notes.htm", "bookmark.website"} {
		t.Run(name, func(t *testing.T) {
			note := RenameEntry{Name: name, Size: 2048}
			if IsJunk(note) {
				t.Fatal("ordinary notes must not be proposed for automatic removal")
			}
			if names, _ := JunkToSweep([]RenameEntry{film, note}); len(names) != 0 {
				t.Fatalf("opening a movie folder would remove %v", names)
			}
			if names, whole := JunkToSweep([]RenameEntry{note}); len(names) != 0 || whole {
				t.Fatal("a folder of notes must not be removed")
			}
		})
	}
}

func TestLibraryCleanupStillRecognizesKnownAdsAndArtifacts(t *testing.T) {
	for _, entry := range []RenameEntry{
		{Name: "RARBG.txt", Size: 31},
		{Name: "www.ads.example.com.url", Size: 80},
		{Name: "_____padding_file_0", Size: 5 << 20},
		{Name: "film.mkv.aria2", Size: 100},
	} {
		if !IsJunk(entry) {
			t.Errorf("known download artifact was not recognized: %s", entry.Name)
		}
	}
}
