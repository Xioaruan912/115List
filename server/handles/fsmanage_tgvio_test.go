package handles

import "testing"

func TestCheckRemoveName(t *testing.T) {
	for name, ok := range map[string]bool{
		"f.bin": true, "a/f.bin": true, "a/b/f.bin": true,
		"": false, "..": false, "a/../f": false, "./f": false, "a//f": false, "a\\f": false, "/f": false,
	} {
		if got := checkRemoveName(name) == nil; got != ok {
			t.Errorf("checkRemoveName(%q) ok = %v", name, got)
		}
	}
}
