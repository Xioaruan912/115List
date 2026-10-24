package tgvio

import "os"

// Env reads a setting from the environment by its name, else by the name it
// had before (TGVIO_…), so a server set up with the old name keeps working.
func Env(name, old string) string {
	if v, ok := os.LookupEnv(name); ok {
		return v
	}
	return os.Getenv(old)
}
