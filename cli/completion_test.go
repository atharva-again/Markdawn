package main

import (
	"strings"
	"testing"
)

func TestCompletionScriptsIncludePageCommands(t *testing.T) {
	for _, shell := range []string{"bash", "zsh", "fish"} {
		script, err := completionScript(shell)
		if err != nil {
			t.Fatal(err)
		}
		for _, command := range []string{"create", "edit", "interactive", "replace", "append", "prepend", "update", "uninstall", "doctor", "skill"} {
			if !strings.Contains(script, command) {
				t.Fatalf("%s completion missing %s", shell, command)
			}
		}
		if strings.Contains(script, "editor-mode") {
			t.Fatalf("%s completion exposes removed command editor-mode", shell)
		}
	}
}
