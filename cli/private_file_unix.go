//go:build !windows

package main

func preparePrivateFileReplacement(_, _ string) error {
	return nil
}
