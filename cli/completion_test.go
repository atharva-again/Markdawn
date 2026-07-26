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
		for _, command := range []string{"create", "edit", "update", "replace"} {
			if !strings.Contains(script, command) {
				t.Fatalf("%s completion missing %s", shell, command)
			}
		}
	}
}
