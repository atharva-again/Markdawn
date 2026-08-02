package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type trackingResponseBody struct {
	reader *bytes.Reader
	closed bool
}

func (body *trackingResponseBody) Read(data []byte) (int, error) {
	return body.reader.Read(data)
}

func (body *trackingResponseBody) Close() error {
	body.closed = true
	return nil
}

func TestDiscardAndCloseResponseDrainsBody(t *testing.T) {
	body := &trackingResponseBody{reader: bytes.NewReader([]byte("response body"))}
	if err := discardAndCloseResponse(&http.Response{Body: body}); err != nil {
		t.Fatal(err)
	}
	if !body.closed {
		t.Fatal("response body was not closed")
	}
	if _, err := body.reader.ReadByte(); err != io.EOF {
		t.Fatalf("response body was not drained: %v", err)
	}
}

func TestCopyFolderPreservesRestrictedItemWarning(t *testing.T) {
	const folderID = "5d418de1-6b6f-4bb3-a35c-bc0c134b48dd"
	const copiedID = "4b4d6a4f-4c1f-46c5-82a8-a7c3572d0f63"
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost || request.URL.Path != "/api/v1/folders/"+folderID+"/copy" {
			t.Fatalf("unexpected request %s %s", request.Method, request.URL.Path)
		}
		fmt.Fprintf(response, "{\"id\":%q,\"name\":\"Copy\",\"skippedRestrictedItems\":true}", copiedID)
	}))
	t.Cleanup(server.Close)

	client, err := newClient(context.Background(), server.URL, "secret", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	copied, err := client.copyFolder(folderID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if copied.ID != copiedID || !copied.SkippedRestrictedItems {
		t.Fatalf("unexpected copy result %#v", copied)
	}
}

func TestFolderCopyCommandReportsSourceAndCopyIDs(t *testing.T) {
	const sourceID = "5d418de1-6b6f-4bb3-a35c-bc0c134b48dd"
	const copiedID = "4b4d6a4f-4c1f-46c5-82a8-a7c3572d0f63"
	runtime, output := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/api/v1/folders/"+sourceID:
			fmt.Fprintf(response, "{\"id\":%q,\"name\":\"Source\"}", sourceID)
		case request.Method == http.MethodPost && request.URL.Path == "/api/v1/folders/"+sourceID+"/copy":
			fmt.Fprintf(response, "{\"id\":%q,\"name\":\"Copy\",\"skippedRestrictedItems\":true}", copiedID)
		default:
			t.Fatalf("unexpected request %s %s", request.Method, request.URL.Path)
		}
	}), true)

	if err := (&FolderCopyCmd{References: []string{sourceID}}).Run(runtime); err != nil {
		t.Fatal(err)
	}
	var result lifecycleBatchResult
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	item := result.Items[0]
	if item.SourceID != sourceID || item.ID != copiedID || !item.SkippedRestrictedItems {
		t.Fatalf("unexpected result %#v", item)
	}
}
