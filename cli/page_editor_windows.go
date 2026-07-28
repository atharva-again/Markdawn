//go:build windows

package main

import "golang.org/x/sys/windows"

func parseEditorCommand(command string) ([]string, error) {
	return windows.DecomposeCommandLine(command)
}
