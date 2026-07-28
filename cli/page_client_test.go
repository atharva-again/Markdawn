package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestApplyPageExactEditRetriesLostResponseBodyWithSameIdempotencyKey(t *testing.T) {
	var lock sync.Mutex
	attempts := 0
	keys := make([]string, 0, 2)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		lock.Lock()
		attempts++
		attempt := attempts
		keys = append(keys, request.Header.Get("Idempotency-Key"))
		lock.Unlock()

		if attempt == 1 {
			hijacker, ok := response.(http.Hijacker)
			if !ok {
				t.Fatal("test server does not support connection hijacking")
			}
			connection, buffered, err := hijacker.Hijack()
			if err != nil {
				t.Fatal(err)
			}
			_, _ = fmt.Fprint(buffered, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 200\r\nConnection: close\r\n\r\n{\"results\":")
			if err := buffered.Flush(); err != nil {
				t.Fatal(err)
			}
			connection.Close()
			return
		}
		response.Header().Set("Content-Type", "application/json")
		fmt.Fprint(response, `{"results":[{"id":"edit","status":"applied"}],"etag":"etag"}`)
	}))
	defer server.Close()

	client, err := newClient(context.Background(), server.URL, "secret", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.applyPageExactEdit(
		"5d418de1-6b6f-4bb3-a35c-bc0c134b48dd",
		exactEdit{ID: "edit", OldText: "before", NewText: "after"},
		"stable-key",
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Results) != 1 || result.Results[0].Status != "applied" {
		t.Fatalf("unexpected result %#v", result)
	}
	lock.Lock()
	defer lock.Unlock()
	if attempts != 2 {
		t.Fatalf("expected two attempts, got %d", attempts)
	}
	if len(keys) != 2 || keys[0] != "stable-key" || keys[1] != "stable-key" {
		t.Fatalf("idempotency key changed across retry: %#v", keys)
	}
}

func TestApplyPageExactEditRetriesServiceUnavailableAndInProgress(t *testing.T) {
	attempts := 0
	keys := make([]string, 0, 3)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		attempts++
		keys = append(keys, request.Header.Get("Idempotency-Key"))
		response.Header().Set("Content-Type", "application/json")
		response.Header().Set("Retry-After", "0")
		switch attempts {
		case 1:
			response.WriteHeader(http.StatusServiceUnavailable)
			fmt.Fprint(response, `{"error":{"code":"collaboration_busy","message":"Unavailable"}}`)
		case 2:
			response.WriteHeader(http.StatusConflict)
			fmt.Fprint(response, `{"error":{"code":"idempotency_in_progress","message":"In progress"}}`)
		default:
			fmt.Fprint(response, `{"results":[{"id":"edit","status":"applied"}],"etag":"etag"}`)
		}
	}))
	defer server.Close()

	client, err := newClient(context.Background(), server.URL, "secret", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.applyPageExactEdit(
		"5d418de1-6b6f-4bb3-a35c-bc0c134b48dd",
		exactEdit{ID: "edit", OldText: "anchor", NewText: "anchor inserted"},
		"stable-key",
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Results) != 1 || result.Results[0].Status != "applied" {
		t.Fatalf("unexpected result %#v", result)
	}
	if attempts != 3 {
		t.Fatalf("expected three attempts, got %d", attempts)
	}
	for _, key := range keys {
		if key != "stable-key" {
			t.Fatalf("idempotency key changed across retries: %#v", keys)
		}
	}
}

func TestApplyPageExactEditPollsInProgressReservationUntilCommandTimeout(t *testing.T) {
	attempts := 0
	keys := make([]string, 0, 6)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		attempts++
		keys = append(keys, request.Header.Get("Idempotency-Key"))
		response.Header().Set("Content-Type", "application/json")
		response.Header().Set("Retry-After", "0")
		response.WriteHeader(http.StatusConflict)
		fmt.Fprint(response, `{"error":{"code":"idempotency_in_progress","message":"In progress"}}`)
	}))
	defer server.Close()

	client, err := newClient(context.Background(), server.URL, "secret", 550*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.applyPageExactEdit(
		"5d418de1-6b6f-4bb3-a35c-bc0c134b48dd",
		exactEdit{ID: "edit", OldText: "before", NewText: "after"},
		"stable-key",
	)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected command deadline, got %v", err)
	}
	if attempts < 4 {
		t.Fatalf("expected polling beyond three attempts, got %d", attempts)
	}
	for _, key := range keys {
		if key != "stable-key" {
			t.Fatalf("idempotency key changed across polling: %#v", keys)
		}
	}
}
