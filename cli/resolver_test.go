package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func stringPointer(value string) *string { return &value }

func TestFolderPathsBuildsNestedPaths(t *testing.T) {
	folders := []folder{
		{ID: "child", ParentID: stringPointer("parent"), Name: "Child"},
		{ID: "parent", Name: "Parent"},
	}
	paths := folderPaths(folders)
	if paths["parent"] != "Parent" || paths["child"] != "Parent/Child" {
		t.Fatalf("unexpected paths %#v", paths)
	}
}

func TestListPagesFollowsCursorPaginationAndHonorsLimit(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requests++
		if requests == 1 {
			fmt.Fprint(response, `{"data":[{"id":"one","title":"One"},{"id":"two","title":"Two"}],"nextCursor":"next"}`)
			return
		}
		if request.URL.Query().Get("cursor") != "next" {
			t.Fatalf("missing cursor: %s", request.URL.RawQuery)
		}
		fmt.Fprint(response, `{"data":[{"id":"three","title":"Three"}],"nextCursor":null}`)
	}))
	defer server.Close()
	client, err := newClient(context.Background(), server.URL, "secret", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	pages, err := client.listPages("", 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(pages) != 3 || requests != 2 {
		t.Fatalf("got %d pages after %d requests", len(pages), requests)
	}
}

func TestListFoldersFollowsCursorPagination(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requests++
		if request.URL.Query().Get("limit") != "100" {
			t.Fatalf("unexpected limit: %s", request.URL.RawQuery)
		}
		if requests == 1 {
			fmt.Fprint(response, `{"data":[{"id":"one","name":"One"}],"nextCursor":"next"}`)
			return
		}
		if request.URL.Query().Get("cursor") != "next" {
			t.Fatalf("missing cursor: %s", request.URL.RawQuery)
		}
		fmt.Fprint(response, `{"data":[{"id":"two","name":"Two"}],"nextCursor":null}`)
	}))
	defer server.Close()
	client, err := newClient(context.Background(), server.URL, "secret", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	folders, err := listFolders(client)
	if err != nil {
		t.Fatal(err)
	}
	if len(folders) != 2 || requests != 2 {
		t.Fatalf("got %d folders after %d requests", len(folders), requests)
	}
}

func TestUUIDValidation(t *testing.T) {
	if !isUUID("5d418de1-6b6f-4bb3-a35c-bc0c134b48dd") {
		t.Fatal("valid UUID rejected")
	}
	if isUUID("not-a-uuid") {
		t.Fatal("invalid UUID accepted")
	}
}

func TestResolvePageReturnsFolderPathsWhenNonInteractive(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/v1/pages/resolve" {
			t.Fatalf("unexpected path %s", request.URL.Path)
		}
		if request.URL.Query().Get("title") != "plan" {
			t.Fatalf("unexpected title query %s", request.URL.RawQuery)
		}
		fmt.Fprint(response, `{"data":[{"id":"two","title":"Plan","folderPath":"/"},{"id":"one","title":"Plan","folderPath":"/Parent/Child"}]}`)
	}))
	defer server.Close()
	client, err := newClient(context.Background(), server.URL, "secret", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	runtime := &runtimeState{ctx: context.Background(), cli: &CLI{NoInput: true}, clientValue: client}
	_, err = runtime.resolvePage("plan")
	var ambiguous *ambiguousPageError
	if !errors.As(err, &ambiguous) {
		t.Fatalf("expected ambiguity, got %v", err)
	}
	if len(ambiguous.Candidates) != 2 || ambiguous.Candidates[1].Path != "/Parent/Child" {
		t.Fatalf("unexpected candidates %#v", ambiguous.Candidates)
	}
}
