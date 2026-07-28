//go:build !windows

package main

func writeStandalonePathProfile(path string, contents []byte) error {
	return writeFileAtomically(path, contents)
}
