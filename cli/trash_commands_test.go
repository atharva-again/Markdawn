package main

import (
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"
)

func TestTrashListFetchesPagesAndFoldersConcurrently(t *testing.T) {
	arrived := make(chan string, 2)
	release := make(chan struct{})
	var releaseOnce sync.Once
	releaseRequests := func() { releaseOnce.Do(func() { close(release) }) }
	defer releaseRequests()
	runtime, _ := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		arrived <- request.URL.Path
		<-release
		switch request.URL.Path {
		case "/api/v1/trash/pages":
			fmt.Fprint(response, `[{"id":"page","title":"Page"}]`)
		case "/api/v1/trash/folders":
			fmt.Fprint(response, `[{"id":"folder","name":"Folder"}]`)
		default:
			http.Error(response, "unexpected path", http.StatusNotFound)
		}
	}), true)

	done := make(chan error, 1)
	go func() { done <- (&TrashListCmd{}).Run(runtime) }()
	for range 2 {
		select {
		case <-arrived:
		case <-time.After(time.Second):
			t.Fatal("page and folder Trash requests were not concurrent")
		}
	}
	releaseRequests()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
