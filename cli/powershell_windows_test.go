//go:build windows

package main

import (
	"strings"
	"testing"
)

func TestPowershellCommandClearsInheritedModulePath(t *testing.T) {
	t.Setenv("PSModulePath", `C:\Program Files\PowerShell\Modules`)
	command := powershellCommand("-Command", "exit 0")
	for _, entry := range command.Env {
		name, _, _ := strings.Cut(entry, "=")
		if strings.EqualFold(name, "PSModulePath") {
			t.Fatal("powershell command inherited PSModulePath")
		}
	}
}
