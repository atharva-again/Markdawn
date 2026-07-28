package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func testRuntime(t *testing.T, handler http.Handler, jsonOutput bool) (*runtimeState, *bytes.Buffer) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	c, err := newClient(context.Background(), server.URL, "secret", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	output := &bytes.Buffer{}
	return &runtimeState{
		ctx: context.Background(), cli: &CLI{JSON: jsonOutput, Timeout: time.Second},
		stdin: bytes.NewReader(nil), stdout: output, stderr: io.Discard, clientValue: c,
	}, output
}

func TestPageListFetchesPagesAndFoldersConcurrently(t *testing.T) {
	arrived := make(chan string, 2)
	release := make(chan struct{})
	var releaseOnce sync.Once
	releaseRequests := func() { releaseOnce.Do(func() { close(release) }) }
	defer releaseRequests()
	runtime, _ := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		arrived <- request.URL.Path
		<-release
		switch request.URL.Path {
		case "/api/v1/pages":
			fmt.Fprint(response, `{"data":[{"id":"page","title":"Page"}],"nextCursor":null}`)
		case "/api/v1/folders":
			fmt.Fprint(response, `{"data":[],"nextCursor":null}`)
		default:
			http.Error(response, "unexpected path", http.StatusNotFound)
		}
	}), true)

	done := make(chan error, 1)
	go func() { done <- (&PageListCmd{}).Run(runtime) }()
	for range 2 {
		select {
		case <-arrived:
		case <-time.After(time.Second):
			t.Fatal("page and folder requests were not concurrent")
		}
	}
	releaseRequests()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestPageCreateSendsInitialMarkdown(t *testing.T) {
	markdownFile, err := os.CreateTemp(t.TempDir(), "page-*.md")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := markdownFile.WriteString("# Authored heading\n"); err != nil {
		t.Fatal(err)
	}
	markdownFile.Close()
	runtime, output := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/api/v1/pages" {
			t.Fatalf("unexpected request %s %s", request.Method, request.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["title"] != "Notes" || body["markdown"] != "# Authored heading\n" || body["icon"] != "📝" {
			t.Fatalf("unexpected body %#v", body)
		}
		response.WriteHeader(http.StatusCreated)
		fmt.Fprint(response, `{"id":"5d418de1-6b6f-4bb3-a35c-bc0c134b48dd","title":"Notes"}`)
	}), true)

	cmd := PageCreateCmd{Title: "Notes", Icon: "📝", ContentFile: markdownFile.Name()}
	if err := cmd.Run(runtime); err != nil {
		t.Fatal(err)
	}
	var created page
	if err := json.Unmarshal(output.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Title != "Notes" {
		t.Fatalf("unexpected page %#v", created)
	}
}

func TestPageUpdateUsesMetadataEndpoint(t *testing.T) {
	pageID := "5d418de1-6b6f-4bb3-a35c-bc0c134b48dd"
	runtime, _ := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/api/v1/pages/"+pageID:
			fmt.Fprintf(response, `{"id":%q,"title":"Old"}`, pageID)
		case request.Method == http.MethodPatch && request.URL.Path == "/api/v1/pages/"+pageID:
			var body map[string]any
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body["title"] != "New" {
				t.Fatalf("unexpected body %#v", body)
			}
			fmt.Fprintf(response, `{"id":%q,"title":"New"}`, pageID)
		default:
			t.Fatalf("unexpected request %s %s", request.Method, request.URL.Path)
		}
	}), true)

	if err := (&PageUpdateCmd{Reference: pageID, Title: "New"}).Run(runtime); err != nil {
		t.Fatal(err)
	}
}

func TestPageEditUsesRequestedEditorAndETag(t *testing.T) {
	pageID := "5d418de1-6b6f-4bb3-a35c-bc0c134b48dd"
	editor := testEditorCommand(t)
	runtime, output := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/api/v1/pages/"+pageID:
			fmt.Fprintf(response, `{"id":%q,"title":"Page"}`, pageID)
		case request.Method == http.MethodGet && request.URL.Path == "/api/v1/pages/"+pageID+"/content":
			response.Header().Set("ETag", `"revision"`)
			fmt.Fprint(response, "Before")
		case request.Method == http.MethodPut && request.URL.Path == "/api/v1/pages/"+pageID+"/content":
			if request.Header.Get("If-Match") != `"revision"` {
				t.Fatalf("unexpected If-Match %q", request.Header.Get("If-Match"))
			}
			body, err := io.ReadAll(request.Body)
			if err != nil {
				t.Fatal(err)
			}
			if string(body) != "Edited" {
				t.Fatalf("unexpected content %q", body)
			}
			response.Header().Set("ETag", `"updated"`)
			response.WriteHeader(http.StatusNoContent)
		default:
			t.Fatalf("unexpected request %s %s", request.Method, request.URL.Path)
		}
	}), true)

	if err := (&PageEditInteractiveCmd{Reference: pageID, Editor: editor}).Run(runtime); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(output.Bytes(), []byte(`"changed": true`)) {
		t.Fatalf("unexpected output %s", output.String())
	}
}

func TestPageEditReturnsConflictWhenTargetDoesNotApply(t *testing.T) {
	pageID := "5d418de1-6b6f-4bb3-a35c-bc0c134b48dd"
	oldFile := t.TempDir() + "/old.txt"
	newFile := t.TempDir() + "/new.txt"
	if err := os.WriteFile(oldFile, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(newFile, []byte("new"), 0o600); err != nil {
		t.Fatal(err)
	}
	runtime, _ := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.Method {
		case http.MethodGet:
			fmt.Fprintf(response, `{"id":%q,"title":"Page"}`, pageID)
		case http.MethodPost:
			fmt.Fprint(response, `{"results":[{"id":"edit","status":"conflict","reason":"old_text_not_found"}],"etag":"etag"}`)
		}
	}), true)

	err := (&PageEditExactCmd{Reference: pageID, OldFile: oldFile, NewFile: newFile, EditID: "edit"}).Run(runtime)
	if exitCode(err) != exitConflict {
		t.Fatalf("expected conflict exit, got %v", err)
	}
}

func TestPageEditAcceptsStringInputsIncludingEmptyReplacement(t *testing.T) {
	pageID := "5d418de1-6b6f-4bb3-a35c-bc0c134b48dd"
	oldText := "remove me"
	newText := ""
	runtime, output := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.Method {
		case http.MethodGet:
			fmt.Fprintf(response, `{"id":%q,"title":"Page"}`, pageID)
		case http.MethodPost:
			var body struct {
				Edits []struct {
					OldText string `json:"oldText"`
					NewText string `json:"newText"`
				} `json:"edits"`
			}
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if len(body.Edits) != 1 || body.Edits[0].OldText != oldText || body.Edits[0].NewText != newText {
				t.Fatalf("unexpected edit %#v", body.Edits)
			}
			fmt.Fprint(response, `{"results":[{"id":"edit","status":"applied"}],"etag":"etag"}`)
		default:
			t.Fatalf("unexpected request %s", request.Method)
		}
	}), true)

	if err := (&PageEditExactCmd{Reference: pageID, OldText: &oldText, NewText: &newText, EditID: "edit"}).Run(runtime); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(output.Bytes(), []byte(`"status": "applied"`)) {
		t.Fatalf("unexpected output %s", output.String())
	}
}

func TestPageEditExpectEmptySendsEmptyPrecondition(t *testing.T) {
	pageID := "5d418de1-6b6f-4bb3-a35c-bc0c134b48dd"
	newText := "# Initial content"
	runtime, _ := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.Method {
		case http.MethodGet:
			fmt.Fprintf(response, `{"id":%q,"title":"Page"}`, pageID)
		case http.MethodPost:
			var body struct {
				Edits []exactEdit `json:"edits"`
			}
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if len(body.Edits) != 1 || body.Edits[0].OldText != "" || body.Edits[0].NewText != newText {
				t.Fatalf("unexpected edit %#v", body.Edits)
			}
			fmt.Fprint(response, `{"results":[{"id":"edit","status":"applied"}],"etag":"etag"}`)
		default:
			t.Fatalf("unexpected request %s", request.Method)
		}
	}), true)

	if err := (&PageEditExactCmd{Reference: pageID, ExpectEmpty: true, NewText: &newText, EditID: "edit"}).Run(runtime); err != nil {
		t.Fatal(err)
	}
}

func TestPageEditExactRejectsEmptyOldInputWithoutExpectEmpty(t *testing.T) {
	pageID := "5d418de1-6b6f-4bb3-a35c-bc0c134b48dd"
	requests := 0
	runtime, _ := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requests++
		response.WriteHeader(http.StatusInternalServerError)
	}), true)

	empty := ""
	err := (&PageEditExactCmd{Reference: pageID, OldText: &empty, NewText: &empty}).Run(runtime)
	if exitCode(err) != exitUsage {
		t.Fatalf("expected usage error for empty old text, got %v", err)
	}
	if requests != 0 {
		t.Fatalf("made %d requests for empty old text", requests)
	}

	emptyFile := t.TempDir() + "/empty.txt"
	if err := os.WriteFile(emptyFile, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	err = (&PageEditExactCmd{Reference: pageID, OldFile: emptyFile, NewText: &empty}).Run(runtime)
	if exitCode(err) != exitUsage {
		t.Fatalf("expected usage error for empty old file, got %v", err)
	}
	if requests != 0 {
		t.Fatalf("made %d requests for empty old file", requests)
	}
}

func TestPageEditReportsGeneratedKeyForUncertainCommitAndSupportsReplay(t *testing.T) {
	pageID := "5d418de1-6b6f-4bb3-a35c-bc0c134b48dd"
	oldText := "anchor"
	newText := "inserted"
	var lock sync.Mutex
	committedKeys := map[string]bool{}
	applications := 0
	runtime, output := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.Method {
		case http.MethodGet:
			fmt.Fprintf(response, `{"id":%q,"title":"Page"}`, pageID)
		case http.MethodPost:
			key := request.Header.Get("Idempotency-Key")
			lock.Lock()
			alreadyCommitted := committedKeys[key]
			if !alreadyCommitted {
				committedKeys[key] = true
				applications++
			}
			lock.Unlock()
			if !alreadyCommitted {
				time.Sleep(250 * time.Millisecond)
			}
			fmt.Fprint(response, `{"results":[{"id":"edit","status":"applied"}],"etag":"etag"}`)
		default:
			t.Fatalf("unexpected request %s", request.Method)
		}
	}), true)
	runtime.clientValue.timeout = 100 * time.Millisecond
	runtime.clientValue.http.Timeout = 100 * time.Millisecond

	first := &PageEditExactCmd{
		Reference: pageID,
		OldText:   &oldText,
		NewText:   &newText,
		EditID:    "edit",
	}
	err := first.Run(runtime)
	var uncertain *cliError
	if !errors.As(err, &uncertain) || uncertain.Code != "edit_outcome_uncertain" {
		t.Fatalf("expected uncertain edit error, got %v", err)
	}
	details, ok := uncertain.Details.(uncertainEditDetails)
	if !ok || details.IdempotencyKey == "" {
		t.Fatalf("missing generated idempotency key: %#v", uncertain.Details)
	}
	if !strings.Contains(uncertain.Message, details.IdempotencyKey) {
		t.Fatalf("human-readable error does not expose generated key: %q", uncertain.Message)
	}
	runtime.printError(err)
	var errorOutput struct {
		Error struct {
			Details uncertainEditDetails `json:"details"`
		} `json:"error"`
	}
	if err := json.Unmarshal(output.Bytes(), &errorOutput); err != nil {
		t.Fatal(err)
	}
	if errorOutput.Error.Details.IdempotencyKey != details.IdempotencyKey {
		t.Fatalf("JSON error omitted generated key: %s", output.String())
	}

	runtime.clientValue.timeout = time.Second
	runtime.clientValue.http.Timeout = time.Second
	replay := &PageEditExactCmd{
		Reference:      pageID,
		OldText:        &oldText,
		NewText:        &newText,
		EditID:         "edit",
		IdempotencyKey: details.IdempotencyKey,
	}
	if err := replay.Run(runtime); err != nil {
		t.Fatal(err)
	}
	lock.Lock()
	defer lock.Unlock()
	if applications != 1 {
		t.Fatalf("edit applied %d times", applications)
	}
}

func TestReplacementInputRequiresOneSource(t *testing.T) {
	if _, err := replacementInput(nil, "", bytes.NewReader(nil), "old"); exitCode(err) != exitUsage {
		t.Fatalf("expected usage error, got %v", err)
	}
	value := "text"
	if _, err := replacementInput(&value, "passage.md", bytes.NewReader(nil), "old"); exitCode(err) != exitUsage {
		t.Fatalf("expected usage error, got %v", err)
	}
}

func TestReadContentFileEnforcesLimitForStdinAndFiles(t *testing.T) {
	exact := bytes.Repeat([]byte("x"), maxContentInputBytes)
	content, err := readContentFile("-", bytes.NewReader(exact))
	if err != nil {
		t.Fatal(err)
	}
	if len(content) != maxContentInputBytes {
		t.Fatalf("read %d bytes", len(content))
	}

	tooLarge := append(exact, 'x')
	if _, err := readContentFile("-", bytes.NewReader(tooLarge)); errorCode(err) != "payload_too_large" {
		t.Fatalf("expected stdin payload_too_large, got %v", err)
	}
	path := t.TempDir() + "/bounded.md"
	if err := os.WriteFile(path, exact, 0o600); err != nil {
		t.Fatal(err)
	}
	if content, err := readContentFile(path, bytes.NewReader(nil)); err != nil || len(content) != maxContentInputBytes {
		t.Fatalf("expected exact-size file, got %d bytes and %v", len(content), err)
	}
	if err := os.WriteFile(path, tooLarge, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := readContentFile(path, bytes.NewReader(nil)); errorCode(err) != "payload_too_large" {
		t.Fatalf("expected file payload_too_large, got %v", err)
	}
}

func TestOversizedStdinFailsBeforeAPIRequest(t *testing.T) {
	requests := 0
	runtime, _ := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requests++
		response.WriteHeader(http.StatusInternalServerError)
	}), true)
	runtime.stdin = bytes.NewReader(bytes.Repeat([]byte("x"), maxContentInputBytes+1))

	err := (&PageCreateCmd{Title: "Too large", ContentFile: "-"}).Run(runtime)
	if errorCode(err) != "payload_too_large" {
		t.Fatalf("expected payload_too_large, got %v", err)
	}
	if requests != 0 {
		t.Fatalf("made %d API requests", requests)
	}
}
