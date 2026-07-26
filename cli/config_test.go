package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestConfigRoundTripUsesRestrictedPermissions(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("MARKDAWN_CONFIG_DIR", dir)
	want := config{BaseURL: "https://example.test", Token: "mdn_secret"}
	if err := saveConfig(want); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(dir, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("config permissions = %o", got)
	}
	got, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("config = %#v, want %#v", got, want)
	}
	if err := removeConfig(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "config.json")); !os.IsNotExist(err) {
		t.Fatalf("config still exists: %v", err)
	}
}

func TestSaveConfigRestrictsExistingFileBeforeReplacingToken(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("MARKDAWN_CONFIG_DIR", dir)
	path := filepath.Join(dir, "config.json")
	if err := os.WriteFile(path, []byte(`{"baseUrl":"https://example.test","token":"old"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatal(err)
	}

	want := config{BaseURL: "https://example.test", Token: "new-secret"}
	if err := saveConfig(want); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("config permissions = %o", got)
	}
	got, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("config = %#v, want %#v", got, want)
	}
}

func TestLoadConfigRejectsInvalidUTF8(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("MARKDAWN_CONFIG_DIR", dir)
	if err := os.WriteFile(filepath.Join(dir, "config.json"), []byte{0x7b, 0x22, 0xff, 0x22, 0x7d}, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadConfig(); err == nil {
		t.Fatal("expected invalid UTF-8 config to fail")
	}
}
