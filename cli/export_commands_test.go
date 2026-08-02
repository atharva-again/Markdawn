package main

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
)

type failingExportReader struct {
	err error
}

func (reader failingExportReader) Read([]byte) (int, error) {
	return 0, reader.err
}

func TestStreamExportFileRemovesIncompleteNewOutput(t *testing.T) {
	output := filepath.Join(t.TempDir(), "export.zip")
	readErr := errors.New("network read failed")

	_, err := streamExportFile(output, failingExportReader{err: readErr}, false)
	if !errors.Is(err, readErr) {
		t.Fatalf("expected stream error, got %v", err)
	}
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		t.Fatalf("expected incomplete export to be removed, stat error %v", err)
	}
}

func TestStreamExportFileDoesNotOverwriteWithoutForce(t *testing.T) {
	output := filepath.Join(t.TempDir(), "export.zip")
	if err := os.WriteFile(output, []byte("original"), 0o600); err != nil {
		t.Fatal(err)
	}

	_, err := streamExportFile(output, bytes.NewReader([]byte("replacement")), false)
	if errorCode(err) != "invalid_arguments" {
		t.Fatalf("expected overwrite refusal, got %v", err)
	}
	content, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "original" {
		t.Fatalf("unexpected overwritten content %q", content)
	}
}

func TestStreamExportFileWritesResponseContent(t *testing.T) {
	output := filepath.Join(t.TempDir(), "export.zip")
	content := bytes.Repeat([]byte("archive"), 4096)

	written, err := streamExportFile(output, bytes.NewReader(content), false)
	if err != nil {
		t.Fatal(err)
	}
	if written != int64(len(content)) {
		t.Fatalf("expected %d bytes, got %d", len(content), written)
	}
	file, err := os.Open(output)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	writtenContent, err := io.ReadAll(file)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(writtenContent, content) {
		t.Fatal("export content did not match")
	}
}

func TestForcedStreamExportPreservesExistingOutputWhenTransferFails(t *testing.T) {
	output := filepath.Join(t.TempDir(), "export.zip")
	if err := os.WriteFile(output, []byte("complete export"), 0o600); err != nil {
		t.Fatal(err)
	}
	readErr := errors.New("network read failed")

	_, err := streamExportFile(
		output,
		io.MultiReader(bytes.NewReader([]byte("partial export")), failingExportReader{err: readErr}),
		true,
	)
	if !errors.Is(err, readErr) {
		t.Fatalf("expected stream error, got %v", err)
	}
	content, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "complete export" {
		t.Fatalf("forced export overwrote valid output with %q", content)
	}
}
