package main

import (
	"strings"
	"testing"
)

func TestTerminalTextEscapesANSIAndOSCControls(t *testing.T) {
	input := "Shared \x1b]52;c;clipboard\x07\n\u009b31mPage"
	got := terminalText(input)
	if strings.ContainsAny(got, "\x1b\x07\n\u009b") {
		t.Fatalf("terminal text retained control characters: %q", got)
	}
	want := `Shared \x1b]52;c;clipboard\a\n\u009b31mPage`
	if got != want {
		t.Fatalf("terminal text = %q, want %q", got, want)
	}
}

func TestTerminalTextPreservesPrintableUnicode(t *testing.T) {
	want := "Roadmap 文档 👩‍💻"
	if got := terminalText(want); got != want {
		t.Fatalf("terminal text = %q, want %q", got, want)
	}
}

func TestCountLabelUsesSingularForOne(t *testing.T) {
	if got := countLabel(1, "page", "pages"); got != "1 page" {
		t.Fatalf("count label = %q, want %q", got, "1 page")
	}
	if got := countLabel(2, "page", "pages"); got != "2 pages" {
		t.Fatalf("count label = %q, want %q", got, "2 pages")
	}
}
