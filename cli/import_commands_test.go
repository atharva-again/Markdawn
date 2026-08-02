package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestScanImportFolderSerializesEmptyMarkdownContent(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "empty.md"), nil, 0o600); err != nil {
		t.Fatal(err)
	}

	files, _, err := scanImportFolder(root)
	if err != nil {
		t.Fatal(err)
	}
	body, err := marshalBody(struct {
		Files []importedVaultFile `json:"files"`
	}{Files: files})
	if err != nil {
		t.Fatal(err)
	}
	var request struct {
		Files []struct {
			Path    string  `json:"path"`
			Content *string `json:"content"`
		} `json:"files"`
	}
	if err := json.Unmarshal(body, &request); err != nil {
		t.Fatal(err)
	}
	if len(request.Files) != 1 || request.Files[0].Path != "empty.md" {
		t.Fatalf("unexpected files %#v", request.Files)
	}
	if request.Files[0].Content == nil || *request.Files[0].Content != "" {
		t.Fatalf("empty Markdown content was omitted: %#v", request.Files[0])
	}
}

func TestScanImportFolderIncludesSvgForServerWarning(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "diagram.svg"), []byte("<svg />"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "note.md"), []byte("# Note"), 0o600); err != nil {
		t.Fatal(err)
	}

	files, preview, err := scanImportFolder(root)
	if err != nil {
		t.Fatal(err)
	}
	if preview.Notes != 1 || preview.Images != 1 {
		t.Fatalf("unexpected preview %#v", preview)
	}
	for _, file := range files {
		if file.Path == "diagram.svg" && file.MIMEType == "image/svg+xml" && file.Data != "" {
			return
		}
	}
	t.Fatalf("SVG was not forwarded to the importer: %#v", files)
}

func TestScanImportFolderRejectsSymbolicLinks(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(t.TempDir(), "private.md")
	if err := os.WriteFile(outside, []byte("private content"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "linked.md")); err != nil {
		t.Skipf("symbolic links are unavailable: %v", err)
	}

	_, _, err := scanImportFolder(root)
	if err == nil || !strings.Contains(err.Error(), "symbolic links are not supported") {
		t.Fatalf("expected symbolic-link rejection, got %v", err)
	}
}

func TestImportPagePrintsWarnings(t *testing.T) {
	file := filepath.Join(t.TempDir(), "page.md")
	if err := os.WriteFile(file, []byte("# Page"), 0o600); err != nil {
		t.Fatal(err)
	}
	runtime, output := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/api/v1/imports/markdown" {
			t.Fatalf("unexpected request %s %s", request.Method, request.URL.Path)
		}
		fmt.Fprint(response, `{"page":{"id":"page-id","title":"Page"},"warnings":[{"code":"LOCAL_IMAGES_NOT_IMPORTED","count":1,"message":"1 local image was not included."}]}`)
	}), false)
	warnings := &bytes.Buffer{}
	runtime.stderr = warnings

	if err := (&ImportPageCmd{Path: file}).Run(runtime); err != nil {
		t.Fatal(err)
	}
	if output.String() != "Markdown page imported.\n" {
		t.Fatalf("unexpected output %q", output.String())
	}
	if !strings.Contains(warnings.String(), "LOCAL_IMAGES_NOT_IMPORTED") ||
		!strings.Contains(warnings.String(), "1 local image was not included.") {
		t.Fatalf("warning was not displayed: %q", warnings.String())
	}
}
