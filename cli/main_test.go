package main

import (
	"testing"

	"github.com/alecthomas/kong"
)

func TestLegacyPageEditReservedTitlesParseAsInteractiveReferences(t *testing.T) {
	for _, test := range []struct {
		name      string
		arguments []string
		title     string
	}{
		{name: "bare", arguments: []string{"page", "edit", "exact"}, title: "exact"},
		{name: "interactive title", arguments: []string{"page", "edit", "interactive"}, title: "interactive"},
		{name: "replace title", arguments: []string{"page", "edit", "replace"}, title: "replace"},
		{name: "append title", arguments: []string{"page", "edit", "append"}, title: "append"},
		{name: "global JSON", arguments: []string{"--json", "page", "edit", "exact"}, title: "exact"},
		{name: "editor flag", arguments: []string{"page", "edit", "exact", "--editor", "vim"}, title: "exact"},
		{name: "all reserved titles", arguments: []string{"page", "edit", "prepend"}, title: "prepend"},
	} {
		t.Run(test.name, func(t *testing.T) {
			cli := CLI{}
			parser, err := kong.New(&cli)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := parser.Parse(normalizeLegacyPageEditArguments(test.arguments)); err != nil {
				t.Fatal(err)
			}
			if cli.Page.Edit.Interactive.Reference != test.title {
				t.Fatalf("interactive reference = %q, want %q", cli.Page.Edit.Interactive.Reference, test.title)
			}
		})
	}
}
