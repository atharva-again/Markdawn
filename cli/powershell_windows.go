//go:build windows

package main

import (
	"os"
	"os/exec"
	"strings"
)

func powershellCommand(arguments ...string) *exec.Cmd {
	command := exec.Command("powershell.exe", arguments...)
	command.Env = withoutPowerShellModulePath(os.Environ())
	return command
}

func withoutPowerShellModulePath(environment []string) []string {
	result := make([]string, 0, len(environment))
	for _, entry := range environment {
		name, _, _ := strings.Cut(entry, "=")
		if strings.EqualFold(name, "PSModulePath") {
			continue
		}
		result = append(result, entry)
	}
	return result
}
