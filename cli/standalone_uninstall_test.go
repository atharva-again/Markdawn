package main

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"unicode/utf16"
)

func TestRemovePathBlockRemovesOnlyMarkedBlock(t *testing.T) {
	path := filepath.Join(t.TempDir(), "profile")
	contents := "before\n# >>> markdawn >>>\nexport PATH=\"/tmp/markdawn:$PATH\"\n# <<< markdawn <<<\nafter\n"
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := removePathBlock(path, "/tmp/markdawn"); err != nil {
		t.Fatal(err)
	}
	updated, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(updated) != "before\nafter\n" {
		t.Fatalf("updated profile = %q", updated)
	}
}

func TestRemovePathBlockPreservesUTF16LEProfile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "Microsoft.PowerShell_profile.ps1")
	contents := "before\r\n# >>> markdawn >>>\r\n$env:Path = 'C:\\Markdawn' + [IO.Path]::PathSeparator + $env:Path\r\n# <<< markdawn <<<\r\nafter\r\n"
	units := utf16.Encode([]rune(contents))
	data := make([]byte, 2+len(units)*2)
	data[0], data[1] = 0xff, 0xfe
	for index, unit := range units {
		binary.LittleEndian.PutUint16(data[2+index*2:], unit)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := removePathBlock(path, "C:\\Markdawn"); err != nil {
		t.Fatal(err)
	}
	updated, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if updated[0] != 0xff || updated[1] != 0xfe {
		t.Fatalf("profile encoding was not preserved: %x", updated[:2])
	}
	decoded, encoding, err := decodeProfile(updated)
	if err != nil {
		t.Fatal(err)
	}
	if encoding != profileUTF16LE || decoded != "before\r\nafter\r\n" {
		t.Fatalf("updated UTF-16 profile = %q (%v)", decoded, encoding)
	}
}

func TestRemovePathBlockPreservesProfilePermissions(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows file permissions are enforced through ACLs rather than Unix mode bits")
	}
	path := filepath.Join(t.TempDir(), "profile")
	contents := "# >>> markdawn >>>\nexport PATH=\"/tmp/markdawn:$PATH\"\n# <<< markdawn <<<\n"
	if err := os.WriteFile(path, []byte(contents), 0o640); err != nil {
		t.Fatal(err)
	}
	if err := removePathBlock(path, "/tmp/markdawn"); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o640 {
		t.Fatalf("profile permissions = %o", info.Mode().Perm())
	}
}

func TestRemovePathBlockPreservesSymlinkedProfile(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows symlink creation requires privileges not guaranteed in CI")
	}
	directory := t.TempDir()
	targetPath := filepath.Join(directory, "profile-target")
	profilePath := filepath.Join(directory, "profile")
	contents := "before\n# >>> markdawn >>>\nexport PATH=\"/tmp/markdawn:$PATH\"\n# <<< markdawn <<<\nafter\n"
	if err := os.WriteFile(targetPath, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(targetPath, profilePath); err != nil {
		t.Fatal(err)
	}
	if err := removePathBlock(profilePath, "/tmp/markdawn"); err != nil {
		t.Fatal(err)
	}
	info, err := os.Lstat(profilePath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode()&os.ModeSymlink == 0 {
		t.Fatal("profile symlink was replaced")
	}
	updated, err := os.ReadFile(targetPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(updated) != "before\nafter\n" {
		t.Fatalf("updated profile target = %q", updated)
	}
}

func TestRemovePathBlockRemovesMatchingInstallationOnly(t *testing.T) {
	path := filepath.Join(t.TempDir(), "profile")
	contents := "# >>> markdawn >>>\nexport PATH=\"/old/markdawn:$PATH\"\n# <<< markdawn <<<\n# >>> markdawn >>>\nexport PATH=\"/new/markdawn:$PATH\"\n# <<< markdawn <<<\n"
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := removePathBlock(path, "/new/markdawn"); err != nil {
		t.Fatal(err)
	}
	updated, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	expected := "# >>> markdawn >>>\nexport PATH=\"/old/markdawn:$PATH\"\n# <<< markdawn <<<\n"
	if string(updated) != expected {
		t.Fatalf("updated profile = %q", updated)
	}
}

func TestRemovePathBlockDoesNotMatchInstallPathPrefix(t *testing.T) {
	path := filepath.Join(t.TempDir(), "profile")
	contents := "# >>> markdawn >>>\nexport PATH=\"/opt/markdawn-old:$PATH\"\n# <<< markdawn <<<\n"
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := removePathBlock(path, "/opt/markdawn"); err == nil {
		t.Fatal("prefix path matched an unrelated block")
	}
}

func TestRemovePathBlockRejectsNestedMarkersWithoutChangingProfile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "profile")
	contents := "before\n# >>> markdawn >>>\nunrelated configuration\n# >>> markdawn >>>\nexport PATH=\"/tmp/markdawn:$PATH\"\n# <<< markdawn <<<\nafter\n"
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := removePathBlock(path, "/tmp/markdawn"); err == nil || !strings.Contains(err.Error(), "nested") {
		t.Fatalf("expected nested block error, got %v", err)
	}
	updated, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(updated) != contents {
		t.Fatalf("nested profile was modified: %q", updated)
	}
}

func TestRemovePathBlockRejectsUnmatchedEndMarkerWithoutChangingProfile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "profile")
	contents := "before\n# <<< markdawn <<<\n# >>> markdawn >>>\nexport PATH=\"/tmp/markdawn:$PATH\"\n# <<< markdawn <<<\nafter\n"
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := removePathBlock(path, "/tmp/markdawn"); err == nil || !strings.Contains(err.Error(), "no matching start") {
		t.Fatalf("expected unmatched end marker error, got %v", err)
	}
	updated, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(updated) != contents {
		t.Fatalf("malformed profile was modified: %q", updated)
	}
}

func TestDecodeProfileRejectsInvalidUTF16BOM(t *testing.T) {
	for _, data := range [][]byte{{0xff, 0xff}, {0xfe, 0xfe}} {
		if _, _, err := decodeProfile(data); err == nil {
			t.Fatalf("invalid BOM %x was accepted", data)
		}
	}
}

func TestRemovePathBlockWithRollbackRestoresProfile(t *testing.T) {
	directory := t.TempDir()
	installDir := filepath.Join(directory, "markdawn")
	path := filepath.Join(directory, "profile")
	contents := "# >>> markdawn >>>\nexport PATH=\"" + installDir + ":$PATH\"\n# <<< markdawn <<<\n"
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	restore, err := removePathBlockWithRollback(path, installDir)
	if err != nil {
		t.Fatal(err)
	}
	updated, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(updated) != "" {
		t.Fatalf("updated profile = %q", updated)
	}
	if err := restore(); err != nil {
		t.Fatal(err)
	}
	restored, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(restored) != contents {
		t.Fatalf("restored profile = %q", restored)
	}
}
