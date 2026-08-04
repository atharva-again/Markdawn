package main

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

type recordingUpdateProgress struct {
	phaseMessages  []string
	downloadLabels []string
	finishCount    int
}

func (progress *recordingUpdateProgress) phase(message string) {
	progress.phaseMessages = append(progress.phaseMessages, message)
}

func (progress *recordingUpdateProgress) download(label string, _, _ int64) {
	progress.downloadLabels = append(progress.downloadLabels, label)
}

func (progress *recordingUpdateProgress) finish() {
	progress.finishCount++
}

type failingProgressWriter struct{}

func (failingProgressWriter) Write([]byte) (int, error) {
	return 0, fmt.Errorf("progress output is closed")
}

func TestUpdateOutcomeJSONIncludesStatus(t *testing.T) {
	cases := []struct {
		status    updateStatus
		updated   bool
		scheduled bool
	}{
		{status: updateStatusUpToDate},
		{status: updateStatusUpdated, updated: true},
		{status: updateStatusScheduled, scheduled: true},
	}
	for _, testCase := range cases {
		t.Run(string(testCase.status), func(t *testing.T) {
			data, err := json.Marshal((updateOutcome{status: testCase.status}).jsonResult())
			if err != nil {
				t.Fatal(err)
			}
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(data, &fields); err != nil {
				t.Fatal(err)
			}
			status, ok := fields["status"]
			if !ok {
				t.Fatalf("JSON result omitted status: %s", data)
			}
			var actualStatus updateStatus
			if err := json.Unmarshal(status, &actualStatus); err != nil {
				t.Fatal(err)
			}
			if actualStatus != testCase.status {
				t.Fatalf("status = %q, want %q", actualStatus, testCase.status)
			}
			var result updateResult
			if err := json.Unmarshal(data, &result); err != nil {
				t.Fatal(err)
			}
			if result.Updated != testCase.updated || result.Scheduled != testCase.scheduled {
				t.Fatalf("compatibility fields = %#v, want updated=%t scheduled=%t", result, testCase.updated, testCase.scheduled)
			}
		})
	}
}

func TestDownloadReleaseAssetWithProgressFinishesReporter(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		_, _ = response.Write([]byte("release asset"))
	}))
	t.Cleanup(server.Close)
	progress := &recordingUpdateProgress{}
	asset, err := downloadReleaseAssetWithProgress(
		context.Background(),
		server.Client(),
		server.URL,
		1024,
		"asset.tar.gz",
		progress,
	)
	if err != nil {
		t.Fatal(err)
	}
	if string(asset) != "release asset" {
		t.Fatalf("downloaded asset = %q", asset)
	}
	if len(progress.downloadLabels) == 0 || progress.downloadLabels[0] != "asset.tar.gz" {
		t.Fatalf("download progress labels = %#v", progress.downloadLabels)
	}
	if progress.finishCount != 1 {
		t.Fatalf("finish called %d times, want 1", progress.finishCount)
	}
}

func TestDownloadReleaseAssetIgnoresProgressWriteErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		_, _ = response.Write([]byte("release asset"))
	}))
	t.Cleanup(server.Close)
	progress := &updateProgressRenderer{writer: failingProgressWriter{}, marker: "==>"}
	asset, err := downloadReleaseAssetWithProgress(
		context.Background(),
		server.Client(),
		server.URL,
		1024,
		"asset.tar.gz",
		progress,
	)
	if err != nil {
		t.Fatalf("download failed because progress output failed: %v", err)
	}
	if string(asset) != "release asset" {
		t.Fatalf("downloaded asset = %q", asset)
	}
}

func TestUpdateProgressRendererRedrawsOnlyWhenPercentChanges(t *testing.T) {
	output := &bytes.Buffer{}
	renderer := &updateProgressRenderer{writer: output, marker: "==>"}
	renderer.download("asset.tar.gz", 1, 100)
	firstDraw := output.Len()
	renderer.download("asset.tar.gz", 1, 100)
	if output.Len() != firstDraw {
		t.Fatal("progress redrew without a percentage change")
	}
	renderer.download("asset.tar.gz", 2, 100)
	if output.Len() <= firstDraw {
		t.Fatal("progress did not redraw after a percentage change")
	}
}

func TestBinariesMatchStreamsContents(t *testing.T) {
	directory := t.TempDir()
	leftPath := filepath.Join(directory, "left")
	rightPath := filepath.Join(directory, "right")
	payload := bytes.Repeat([]byte("markdawn"), 8192)
	if err := os.WriteFile(leftPath, payload, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(rightPath, payload, 0o755); err != nil {
		t.Fatal(err)
	}
	match, err := binariesMatch(leftPath, rightPath)
	if err != nil {
		t.Fatal(err)
	}
	if !match {
		t.Fatal("identical binaries did not match")
	}
	if err := os.WriteFile(rightPath, append(payload, '!'), 0o755); err != nil {
		t.Fatal(err)
	}
	match, err = binariesMatch(leftPath, rightPath)
	if err != nil {
		t.Fatal(err)
	}
	if match {
		t.Fatal("different binaries matched")
	}
}

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
	receipt := installReceipt{InstallDir: installDir, BinaryPath: binaryPath}
	outcome, err := updateStandalone(context.Background(), receipt, "", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	if outcome.status == updateStatusScheduled {
		t.Fatal("Unix update was deferred")
	}
	if outcome.status != updateStatusUpdated {
		t.Fatal("Unix update was not applied")
	}
	contents, err := os.ReadFile(binaryPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "new binary" {
		t.Fatalf("updated binary = %q", contents)
	}
	outcome, err = updateStandalone(context.Background(), receipt, "", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	if outcome.status != updateStatusUpToDate {
		t.Fatalf("identical update was applied: %#v", outcome)
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
