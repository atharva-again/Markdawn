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

func TestApplyPageExactEditDoesNotRetryLostResponseBody(t *testing.T) {
	attempts := 0
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		attempts++
		if request.Header.Get("Idempotency-Key") != "stable-key" {
			t.Fatalf("unexpected idempotency key %q", request.Header.Get("Idempotency-Key"))
		}
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
	}))
	defer server.Close()

	client, err := newClient(context.Background(), server.URL, "secret", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.applyPageExactEdit(
		"5d418de1-6b6f-4bb3-a35c-bc0c134b48dd",
		exactEdit{ID: "edit", OldText: "before", NewText: "after"},
		"stable-key",
	)
	if err == nil {
		t.Fatal("lost response body was accepted")
	}
	if attempts != 1 {
		t.Fatalf("expected one request, got %d", attempts)
	}
}

func TestApplyPageExactEditDoesNotRetryServerErrors(t *testing.T) {
	tests := []struct {
		name       string
		statusCode int
		body       string
		code       string
	}{
		{
			name:       "service unavailable",
			statusCode: http.StatusServiceUnavailable,
			body:       `{"error":{"code":"collaboration_busy","message":"Unavailable"}}`,
			code:       "collaboration_busy",
		},
		{
			name:       "idempotency in progress",
			statusCode: http.StatusConflict,
			body:       `{"error":{"code":"idempotency_in_progress","message":"In progress"}}`,
			code:       "idempotency_in_progress",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			attempts := 0
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				attempts++
				response.Header().Set("Content-Type", "application/json")
				response.Header().Set("Retry-After", "1")
				response.WriteHeader(test.statusCode)
				fmt.Fprint(response, test.body)
			}))
			t.Cleanup(server.Close)
			client, err := newClient(context.Background(), server.URL, "secret", time.Second)
			if err != nil {
				t.Fatal(err)
			}
			_, err = client.applyPageExactEdit(
				"5d418de1-6b6f-4bb3-a35c-bc0c134b48dd",
				exactEdit{ID: "edit", OldText: "before", NewText: "after"},
				"stable-key",
			)
			var requestError *cliError
			if !errors.As(err, &requestError) || requestError.Code != test.code {
				t.Fatalf("unexpected error %v", err)
			}
			if attempts != 1 {
				t.Fatalf("expected one request, got %d", attempts)
			}
		})
	}
}
