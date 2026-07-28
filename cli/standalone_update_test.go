package main

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestExtractReleaseBinaryAcceptsDotSlashTarPath(t *testing.T) {
	var archive bytes.Buffer
	gzipWriter := gzip.NewWriter(&archive)
	tarWriter := tar.NewWriter(gzipWriter)
	payload := []byte("markdawn binary")
	if err := tarWriter.WriteHeader(&tar.Header{Name: "./" + executableName(), Mode: 0o755, Size: int64(len(payload)), Typeflag: tar.TypeReg}); err != nil {
		t.Fatal(err)
	}
	if _, err := tarWriter.Write(payload); err != nil {
		t.Fatal(err)
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), executableName())
	if err := extractReleaseBinary(archive.Bytes(), "markdawn_linux_amd64.tar.gz", target); err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(actual) != string(payload) {
		t.Fatalf("extracted binary = %q", actual)
	}
}

func TestUpdateStandaloneVerifiesAndReplacesBinary(t *testing.T) {
	if executableName() != "markdawn" {
		t.Skip("Unix replacement is covered by this test")
	}
	archive := releaseTarball(t, "./markdawn", []byte("new binary"))
	checksum := fmt.Sprintf("%x", sha256.Sum256(archive))
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/latest/download/checksums.txt":
			_, _ = fmt.Fprintf(response, "%s  markdawn_%s_%s.tar.gz\n", checksum, runtime.GOOS, runtime.GOARCH)
		case "/latest/download/markdawn_" + runtime.GOOS + "_" + runtime.GOARCH + ".tar.gz":
			_, _ = response.Write(archive)
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()
	previousBaseURL := releaseBaseURL
	releaseBaseURL = server.URL
	t.Cleanup(func() { releaseBaseURL = previousBaseURL })
	installDir := t.TempDir()
	binaryPath := filepath.Join(installDir, executableName())
	if err := os.WriteFile(binaryPath, []byte("old binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	deferred, err := updateStandalone(context.Background(), installReceipt{InstallDir: installDir, BinaryPath: binaryPath}, "", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	if deferred {
		t.Fatal("Unix update was deferred")
	}
	contents, err := os.ReadFile(binaryPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "new binary" {
		t.Fatalf("updated binary = %q", contents)
	}
}

func TestUpdateStandaloneRejectsChecksumMismatch(t *testing.T) {
	archive := []byte("not an archive")
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/latest/download/checksums.txt" {
			_, _ = fmt.Fprintf(response, "%064d  %s\n", 0, releaseArchiveName(""))
			return
		}
		_, _ = response.Write(archive)
	}))
	defer server.Close()
	previousBaseURL := releaseBaseURL
	releaseBaseURL = server.URL
	t.Cleanup(func() { releaseBaseURL = previousBaseURL })
	_, err := updateStandalone(context.Background(), installReceipt{InstallDir: t.TempDir(), BinaryPath: filepath.Join(t.TempDir(), executableName())}, "", server.Client())
	if err == nil || !strings.Contains(err.Error(), "SHA-256") {
		t.Fatalf("expected checksum failure, got %v", err)
	}
}

func TestExpectedReleaseChecksumRejectsDuplicateAndMalformedEntries(t *testing.T) {
	asset := "markdawn_linux_amd64.tar.gz"
	valid := strings.Repeat("a", 64)
	if _, err := expectedReleaseChecksum([]byte(valid+"  "+asset+"\n"+valid+"  "+asset+"\n"), asset); err == nil || !strings.Contains(err.Error(), "multiple") {
		t.Fatalf("expected duplicate checksum failure, got %v", err)
	}
	if _, err := expectedReleaseChecksum([]byte(strings.Repeat("z", 64)+"  "+asset+"\n"), asset); err == nil || !strings.Contains(err.Error(), "invalid") {
		t.Fatalf("expected malformed checksum failure, got %v", err)
	}
}

func TestExtractReleaseBinaryAcceptsZipBinary(t *testing.T) {
	var archive bytes.Buffer
	zipWriter := zip.NewWriter(&archive)
	file, err := zipWriter.Create(executableName())
	if err != nil {
		t.Fatal(err)
	}
	payload := []byte("windows binary")
	if _, err := file.Write(payload); err != nil {
		t.Fatal(err)
	}
	if err := zipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), executableName())
	if err := extractReleaseBinary(archive.Bytes(), "markdawn_windows_amd64.zip", target); err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(actual) != string(payload) {
		t.Fatalf("extracted binary = %q", actual)
	}
}

func TestExtractReleaseBinaryRejectsDuplicateZipBinary(t *testing.T) {
	var archive bytes.Buffer
	zipWriter := zip.NewWriter(&archive)
	for range 2 {
		file, err := zipWriter.Create(executableName())
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write([]byte("windows binary")); err != nil {
			t.Fatal(err)
		}
	}
	if err := zipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	err := extractReleaseBinary(archive.Bytes(), "markdawn_windows_amd64.zip", filepath.Join(t.TempDir(), executableName()))
	if err == nil || !strings.Contains(err.Error(), "multiple") {
		t.Fatalf("expected duplicate binary failure, got %v", err)
	}
}

func TestExtractReleaseBinaryRejectsZipWithTooManyEntries(t *testing.T) {
	var archive bytes.Buffer
	zipWriter := zip.NewWriter(&archive)
	for index := 0; index <= maxReleaseArchiveEntries; index++ {
		if _, err := zipWriter.Create(fmt.Sprintf("entry-%d", index)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	err := extractReleaseBinary(archive.Bytes(), "markdawn_windows_amd64.zip", filepath.Join(t.TempDir(), executableName()))
	if err == nil || !strings.Contains(err.Error(), "entries") {
		t.Fatalf("expected ZIP entry limit failure, got %v", err)
	}
}

func TestExtractReleaseBinaryRejectsDuplicateTarBinary(t *testing.T) {
	archive := releaseTarballEntries(t, []string{executableName(), "./" + executableName()}, []byte("markdawn binary"))
	err := extractReleaseBinary(archive, "markdawn_linux_amd64.tar.gz", filepath.Join(t.TempDir(), executableName()))
	if err == nil || !strings.Contains(err.Error(), "multiple") {
		t.Fatalf("expected duplicate binary failure, got %v", err)
	}
}

func TestExtractReleaseBinaryRejectsOversizedTarBinary(t *testing.T) {
	var archive bytes.Buffer
	gzipWriter := gzip.NewWriter(&archive)
	tarWriter := tar.NewWriter(gzipWriter)
	if err := tarWriter.WriteHeader(&tar.Header{Name: executableName(), Mode: 0o755, Size: maxReleaseBinaryBytes + 1, Typeflag: tar.TypeReg}); err != nil {
		t.Fatal(err)
	}
	if err := tarWriter.Close(); err == nil {
		t.Fatal("tar writer accepted missing oversized payload")
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), executableName())
	err := extractReleaseBinary(archive.Bytes(), "markdawn_linux_amd64.tar.gz", target)
	if err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("expected oversized binary failure, got %v", err)
	}
}

func TestExtractReleaseBinaryRejectsTarWithTooManyEntries(t *testing.T) {
	names := make([]string, maxReleaseArchiveEntries+1)
	for index := range names {
		names[index] = fmt.Sprintf("entry-%d", index)
	}
	archive := releaseTarballEntries(t, names, nil)
	err := extractReleaseBinary(archive, "markdawn_linux_amd64.tar.gz", filepath.Join(t.TempDir(), executableName()))
	if err == nil || !strings.Contains(err.Error(), "entries") {
		t.Fatalf("expected archive entry limit failure, got %v", err)
	}
}

func TestExtractReleaseBinaryRejectsOversizedTarContents(t *testing.T) {
	var archive bytes.Buffer
	gzipWriter := gzip.NewWriter(&archive)
	tarWriter := tar.NewWriter(gzipWriter)
	if err := tarWriter.WriteHeader(&tar.Header{Name: "payload", Mode: 0o644, Size: maxReleaseArchiveBytes + 1, Typeflag: tar.TypeReg}); err != nil {
		t.Fatal(err)
	}
	if err := tarWriter.Close(); err == nil {
		t.Fatal("tar writer accepted missing oversized payload")
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	err := extractReleaseBinary(archive.Bytes(), "markdawn_linux_amd64.tar.gz", filepath.Join(t.TempDir(), executableName()))
	if err == nil || !strings.Contains(err.Error(), "decompressed") {
		t.Fatalf("expected decompressed contents failure, got %v", err)
	}
}

func releaseTarball(t *testing.T, name string, payload []byte) []byte {
	return releaseTarballEntries(t, []string{name}, payload)
}

func releaseTarballEntries(t *testing.T, names []string, payload []byte) []byte {
	t.Helper()
	var result bytes.Buffer
	gzipWriter := gzip.NewWriter(&result)
	tarWriter := tar.NewWriter(gzipWriter)
	for _, name := range names {
		if err := tarWriter.WriteHeader(&tar.Header{Name: name, Mode: 0o755, Size: int64(len(payload)), Typeflag: tar.TypeReg}); err != nil {
			t.Fatal(err)
		}
		if _, err := tarWriter.Write(payload); err != nil {
			t.Fatal(err)
		}
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	return result.Bytes()
}
