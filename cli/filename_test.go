package main

import (
	"strings"
	"testing"
)

func TestAllocateFilenameIsUniqueAndLengthLimited(t *testing.T) {
	used := make(map[string]struct{})
	if got := allocateFilename("A", ".md", used, "Untitled"); got != "A.md" {
		t.Fatalf("unexpected first filename %q", got)
	}
	if got := allocateFilename("a", ".md", used, "Untitled"); got != "a (2).md" {
		t.Fatalf("unexpected duplicate filename %q", got)
	}
	if got := allocateFilename("A (2)", ".md", used, "Untitled"); got != "A (3).md" {
		t.Fatalf("unexpected numbered filename %q", got)
	}

	long := allocateFilename(strings.Repeat("研", 200), ".md", used, "Untitled")
	if len([]byte(long)) > maxSafeFilenameBytes {
		t.Fatalf("filename is %d bytes", len([]byte(long)))
	}
}

func TestReadableFilenameRemovesCrossPlatformCharacters(t *testing.T) {
	if got := readableFilename(`Plans: Q1/Q2?`, "Untitled"); got != "Plans- Q1-Q2-" {
		t.Fatalf("unexpected filename %q", got)
	}
	for input, expected := range map[string]string{
		"CON":         "CON_",
		"CON.txt":     "CON_.txt",
		"lpt1.backup": "lpt1_.backup",
		"notes.txt":   "notes.txt",
	} {
		if got := readableFilename(input, "Untitled"); got != expected {
			t.Fatalf("readableFilename(%q) = %q, want %q", input, got, expected)
		}
	}
}
