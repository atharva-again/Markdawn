//go:build !windows

package main

import (
	"os"
	"path/filepath"
	"testing"
)

func testEditorCommand(t *testing.T) string {
	t.Helper()
	editor := filepath.Join(t.TempDir(), "editor")
	if err := os.WriteFile(editor, []byte("#!/bin/sh\nprintf 'Edited' > \"$1\"\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	return editor
}
