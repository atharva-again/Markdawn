package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAddStandalonePathBlockRollsBackNewProfile(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "profile")
	installDir := filepath.Join(directory, "bin")
	ownedPath, restore, err := addStandalonePathBlock(path, installDir, "sh")
	if err != nil {
		t.Fatal(err)
	}
	if ownedPath != path {
		t.Fatalf("owned path = %q", ownedPath)
	}
	if err := restore(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("profile exists after rollback: %v", err)
	}
}

func TestAddStandalonePathBlockAddsOwnedBlockAlongsideForeignBlock(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "profile")
	contents := "# >>> markdawn >>>\nexport PATH=\"/other:$PATH\"\n# <<< markdawn <<<\n"
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	ownedPath, restore, err := addStandalonePathBlock(path, filepath.Join(directory, "bin"), "sh")
	if err != nil {
		t.Fatal(err)
	}
	if ownedPath != path {
		t.Fatalf("owned path = %q", ownedPath)
	}
	updated, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(updated) == contents || !blockContainsInstallPath(string(updated), filepath.Join(directory, "bin")) {
		t.Fatalf("owned PATH block was not added: %q", updated)
	}
	if err := restore(); err != nil {
		t.Fatal(err)
	}
	restored, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(restored) != contents {
		t.Fatalf("profile was not restored: %q", restored)
	}
}

func TestStandaloneFinalizeMovesPathOwnershipToNewProfile(t *testing.T) {
	directory := t.TempDir()
	stateDir := filepath.Join(directory, "state")
	installDir := filepath.Join(directory, "bin")
	firstProfile := filepath.Join(directory, "first-profile")
	secondProfile := filepath.Join(directory, "second-profile")
	t.Setenv("MARKDAWN_INSTALL_STATE_DIR", stateDir)
	if err := (&StandaloneFinalizeCmd{InstallDir: installDir, PathFile: firstProfile, PathStyle: "sh"}).Run(nil); err != nil {
		t.Fatal(err)
	}
	if err := (&StandaloneFinalizeCmd{InstallDir: installDir, PathFile: secondProfile, PathStyle: "sh"}).Run(nil); err != nil {
		t.Fatal(err)
	}
	firstContents, err := os.ReadFile(firstProfile)
	if err != nil {
		t.Fatal(err)
	}
	if blockContainsInstallPath(string(firstContents), installDir) {
		t.Fatalf("previous profile retains installer PATH block: %q", firstContents)
	}
	secondContents, err := os.ReadFile(secondProfile)
	if err != nil {
		t.Fatal(err)
	}
	if !blockContainsInstallPath(string(secondContents), installDir) {
		t.Fatalf("new profile does not contain installer PATH block: %q", secondContents)
	}
	receipt, err := os.ReadFile(filepath.Join(stateDir, "install.json"))
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := decodeInstallReceipt(receipt)
	if err != nil {
		t.Fatal(err)
	}
	if decoded.PathFile != secondProfile {
		t.Fatalf("receipt pathFile = %q", decoded.PathFile)
	}
}

func TestAddStandalonePathBlockRejectsMalformedBlock(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "profile")
	contents := "# >>> markdawn >>>\n# >>> markdawn >>>\n"
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := addStandalonePathBlock(path, filepath.Join(directory, "bin"), "sh"); err == nil {
		t.Fatal("malformed PATH block was accepted")
	}
}

func TestStandaloneFinalizePublishesReceipt(t *testing.T) {
	directory := t.TempDir()
	stateDir := filepath.Join(directory, "state")
	installDir := filepath.Join(directory, "bin")
	t.Setenv("MARKDAWN_INSTALL_STATE_DIR", stateDir)
	if err := (&StandaloneFinalizeCmd{InstallDir: installDir}).Run(nil); err != nil {
		t.Fatal(err)
	}
	receipt, err := os.ReadFile(filepath.Join(stateDir, "install.json"))
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := decodeInstallReceipt(receipt)
	if err != nil {
		t.Fatal(err)
	}
	if decoded.InstallDir != installDir || decoded.BinaryPath != filepath.Join(installDir, executableName()) {
		t.Fatalf("receipt = %#v", decoded)
	}
}

func TestReplaceStandaloneBinaryRejectsNonRegularDestination(t *testing.T) {
	directory := t.TempDir()
	staged := filepath.Join(directory, "staged")
	destination := filepath.Join(directory, executableName())
	if err := os.WriteFile(staged, []byte("binary"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(destination, 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := replaceStandaloneBinary(staged, destination); err == nil {
		t.Fatal("non-regular destination was accepted")
	}
	if _, err := os.Stat(destination); err != nil {
		t.Fatalf("destination was changed: %v", err)
	}
}
