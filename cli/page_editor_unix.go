//go:build !windows

package main

import "github.com/mattn/go-shellwords"

func parseEditorCommand(command string) ([]string, error) {
	return shellwords.Parse(command)
}
