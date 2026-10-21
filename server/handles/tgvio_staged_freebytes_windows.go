//go:build windows

package handles

// freeBytes returns -1 when the platform-specific free-space query is not
// available. The staged upload path treats a negative value as unknown and
// lets the write itself report a full disk.
func freeBytes(dir string) int64 {
	return -1
}
