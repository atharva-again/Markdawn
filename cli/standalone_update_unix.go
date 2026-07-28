//go:build !windows

package main

import "os"

func replaceUpdatedBinary(destination, staged string) (bool, error) {
	if err := os.Rename(staged, destination); err != nil {
		return false, err
	}
	return false, nil
}
