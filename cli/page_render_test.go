package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestRenderPageListEscapesTerminalControlsInMetadata(t *testing.T) {
	output := &bytes.Buffer{}
	runtime := &runtimeState{
		cli:    &CLI{Plain: true},
		stdout: output,
	}
	item := pageListItem{
		page:       page{ID: "page\x1b[31m", Title: "Shared\x1b]52;c;clipboard\x07\nPage"},
		FolderPath: "/Team\u009b31m/Plans",
	}

	if err := renderPageList(runtime, []pageListItem{item}); err != nil {
		t.Fatal(err)
	}
	got := output.String()
	if strings.ContainsAny(got, "\x1b\x07\u009b") {
		t.Fatalf("rendered output retained terminal controls: %q", got)
	}
	for _, escaped := range []string{`\x1b`, `\a`, `\n`, `\u009b`} {
		if !strings.Contains(got, escaped) {
			t.Fatalf("rendered output %q is missing %q", got, escaped)
		}
	}
}

func TestRenderPageListPreservesMetadataInJSON(t *testing.T) {
	output := &bytes.Buffer{}
	runtime := &runtimeState{cli: &CLI{JSON: true}, stdout: output}
	item := pageListItem{
		page:       page{ID: "page-id", Title: "Shared\x1b]52;c;clipboard\x07"},
		FolderPath: "/Team\nPlans",
	}

	if err := renderPageList(runtime, []pageListItem{item}); err != nil {
		t.Fatal(err)
	}
	var decoded []pageListItem
	if err := json.Unmarshal(output.Bytes(), &decoded); err != nil {
		t.Fatal(err)
	}
	if len(decoded) != 1 || decoded[0].Title != item.Title || decoded[0].FolderPath != item.FolderPath {
		t.Fatalf("JSON metadata changed: %#v", decoded)
	}
}
