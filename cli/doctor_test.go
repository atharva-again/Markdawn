package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestDoctorChecksSavedAuthentication(t *testing.T) {
	t.Setenv("MARKDAWN_TOKEN", "")
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet || request.URL.Path != "/api/v1/me" {
			t.Fatalf("unexpected request %s %s", request.Method, request.URL.Path)
		}
		fmt.Fprint(response, `{"id":"user","name":"Ada","email":"ada@example.com","authentication":"token","scopes":["pages:read"]}`)
	}))
	t.Cleanup(server.Close)
	client, err := newClient(t.Context(), server.URL, "secret", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	output := &bytes.Buffer{}
	runtime := &runtimeState{
		ctx:         t.Context(),
		cli:         &CLI{JSON: true, Timeout: time.Second},
		stdout:      output,
		clientValue: client,
		configValue: &config{BaseURL: server.URL, Token: "secret"},
	}
	if err := (&DoctorCmd{}).Run(runtime); err != nil {
		t.Fatal(err)
	}
	var result doctorResult
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Authentication.Status != "authenticated" || result.Authentication.Source != "saved configuration" || result.Authentication.User != "ada@example.com" || tokenAccess(result.Authentication.Scopes) != "read-only" {
		t.Fatalf("unexpected authentication result %#v", result.Authentication)
	}
}

func TestDoctorReportsMissingAuthenticationWithoutNetwork(t *testing.T) {
	t.Setenv("MARKDAWN_TOKEN", "")
	output := &bytes.Buffer{}
	runtime := &runtimeState{
		ctx:         t.Context(),
		cli:         &CLI{JSON: true, Timeout: time.Second},
		stdout:      output,
		configValue: &config{BaseURL: "https://markdawn.example.com"},
	}
	if err := (&DoctorCmd{}).Run(runtime); err != nil {
		t.Fatal(err)
	}
	var result doctorResult
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Authentication.Status != "not_authenticated" {
		t.Fatalf("unexpected authentication result %#v", result.Authentication)
	}
}

func TestDoctorRendersIndependentChecksWhenAuthenticationFails(t *testing.T) {
	t.Setenv("MARKDAWN_TOKEN", "")
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.WriteHeader(http.StatusUnauthorized)
		fmt.Fprint(response, `{"error":{"code":"not_authenticated","message":"Invalid token"}}`)
	}))
	t.Cleanup(server.Close)
	client, err := newClient(t.Context(), server.URL, "secret", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	output := &bytes.Buffer{}
	runtime := &runtimeState{
		ctx:         t.Context(),
		cli:         &CLI{JSON: true, Timeout: time.Second},
		stdout:      output,
		clientValue: client,
		configValue: &config{BaseURL: server.URL, Token: "secret"},
	}
	err = (&DoctorCmd{}).Run(runtime)
	if errorCode(err) != "doctor_unhealthy" {
		t.Fatalf("expected unhealthy doctor result, got %v", err)
	}
	var result doctorResult
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Authentication.Status != "unhealthy" || result.Standalone.Status == "" || result.Skills.Status == "" {
		t.Fatalf("missing diagnostics %#v", result)
	}
}
