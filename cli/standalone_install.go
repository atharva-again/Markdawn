package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"unicode/utf8"
)

const (
	standaloneInstallMethod = "standalone"
	pathBlockStart          = "# >>> markdawn >>>"
	pathBlockEnd            = "# <<< markdawn <<<"
)

var releaseVersionPattern = regexp.MustCompile(`^v?[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$`)

type installReceipt struct {
	SchemaVersion int    `json:"schemaVersion"`
	InstallMethod string `json:"installMethod"`
	InstallDir    string `json:"installDir"`
	BinaryPath    string `json:"binaryPath"`
	PathFile      string `json:"pathFile"`
}

func installStateDir() (string, error) {
	if dir := os.Getenv("MARKDAWN_INSTALL_STATE_DIR"); dir != "" {
		return dir, nil
	}
	if runtime.GOOS == "windows" {
		if dir := os.Getenv("LOCALAPPDATA"); dir != "" {
			return filepath.Join(dir, "Markdawn"), nil
		}
		dir, err := os.UserConfigDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(dir, "Markdawn"), nil
	}
	if dir := os.Getenv("XDG_STATE_HOME"); dir != "" {
		return filepath.Join(dir, "markdawn"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".local", "state", "markdawn"), nil
}

func installReceiptPath() (string, error) {
	dir, err := installStateDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "install.json"), nil
}

func loadInstallReceipt() (installReceipt, string, error) {
	path, err := installReceiptPath()
	if err != nil {
		return installReceipt{}, "", err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		backupPath := path + ".uninstall-backup"
		data, err = os.ReadFile(backupPath)
		if errors.Is(err, os.ErrNotExist) {
			return installReceipt{}, path, unmanagedInstallError()
		}
		if err != nil {
			return installReceipt{}, path, fmt.Errorf("read standalone install receipt recovery backup: %w", err)
		}
		receipt, err := decodeInstallReceipt(data)
		if err != nil {
			return installReceipt{}, path, fmt.Errorf("read standalone install receipt recovery backup: %w", err)
		}
		if _, err := os.Stat(receipt.BinaryPath); errors.Is(err, os.ErrNotExist) {
			return installReceipt{}, path, unmanagedInstallError()
		} else if err != nil {
			return installReceipt{}, path, fmt.Errorf("verify standalone binary before receipt recovery: %w", err)
		}
		if err := os.Rename(backupPath, path); err != nil {
			return installReceipt{}, path, fmt.Errorf("restore standalone install receipt recovery backup: %w", err)
		}
		return receipt, path, nil
	}
	if err != nil {
		return installReceipt{}, path, fmt.Errorf("read standalone install receipt: %w", err)
	}
	receipt, err := decodeInstallReceipt(data)
	if err != nil {
		return installReceipt{}, path, fmt.Errorf("read standalone install receipt: %w", err)
	}
	return receipt, path, nil
}

func decodeInstallReceipt(data []byte) (installReceipt, error) {
	if !utf8.Valid(data) {
		return installReceipt{}, fmt.Errorf("invalid UTF-8")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var receipt installReceipt
	if err := decoder.Decode(&receipt); err != nil {
		return installReceipt{}, err
	}
	var trailing struct{}
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return installReceipt{}, fmt.Errorf("multiple JSON values")
		}
		return installReceipt{}, err
	}
	if err := validateInstallReceipt(receipt); err != nil {
		return installReceipt{}, err
	}
	return receipt, nil
}

func validateInstallReceipt(receipt installReceipt) error {
	if receipt.SchemaVersion != 1 || receipt.InstallMethod != standaloneInstallMethod {
		return unmanagedInstallError()
	}
	if !filepath.IsAbs(receipt.InstallDir) || !filepath.IsAbs(receipt.BinaryPath) {
		return fmt.Errorf("read standalone install receipt: installation paths must be absolute")
	}
	if filepath.Clean(receipt.BinaryPath) != filepath.Join(filepath.Clean(receipt.InstallDir), executableName()) {
		return fmt.Errorf("read standalone install receipt: binary path is outside the installation directory")
	}
	if receipt.PathFile != "" && !filepath.IsAbs(receipt.PathFile) {
		return fmt.Errorf("read standalone install receipt: PATH file must be absolute")
	}
	return nil
}

func executableName() string {
	if runtime.GOOS == "windows" {
		return "markdawn.exe"
	}
	return "markdawn"
}

func managedInstall() (installReceipt, string, error) {
	receipt, receiptPath, err := loadInstallReceipt()
	if err != nil {
		return installReceipt{}, "", err
	}
	executable, err := os.Executable()
	if err != nil {
		return installReceipt{}, "", fmt.Errorf("locate current executable: %w", err)
	}
	match, err := sameFilePath(executable, receipt.BinaryPath)
	if err != nil {
		return installReceipt{}, "", err
	}
	if !match {
		return installReceipt{}, "", unmanagedInstallError()
	}
	return receipt, receiptPath, nil
}

func sameFilePath(left, right string) (bool, error) {
	resolvedLeft, err := filepath.EvalSymlinks(left)
	if err != nil {
		return false, fmt.Errorf("resolve executable path: %w", err)
	}
	resolvedRight, err := filepath.EvalSymlinks(right)
	if err != nil {
		return false, fmt.Errorf("resolve standalone installation path: %w", err)
	}
	if runtime.GOOS == "windows" {
		return strings.EqualFold(resolvedLeft, resolvedRight), nil
	}
	return resolvedLeft == resolvedRight, nil
}

func unmanagedInstallError() error {
	return &cliError{
		Code:    "unmanaged_install",
		Message: "this Markdawn binary is not managed by the standalone installer; update it with go install github.com/atharva-again/Markdawn/cli@latest",
	}
}

func (cmd *UpdateCmd) Run(r *runtimeState) error {
	if cmd.Version != "" && !releaseVersionPattern.MatchString(cmd.Version) {
		return usageError("version must be a semantic version such as v1.2.3")
	}
	receipt, _, err := managedInstall()
	if err != nil {
		return err
	}
	deferred, err := updateStandalone(r.ctx, receipt, cmd.Version, &http.Client{Timeout: r.cli.Timeout})
	if err != nil {
		if errorCode(err) == "invalid_arguments" {
			return err
		}
		return &cliError{Code: "update_failed", Message: "standalone update failed", Cause: err}
	}
	if r.cli.JSON {
		return r.printJSON(updateResult{Updated: !deferred, Scheduled: deferred})
	}
	if deferred {
		_, err = fmt.Fprintln(r.stdout, "Markdawn update is scheduled and will finish after this command exits.")
	} else {
		_, err = fmt.Fprintln(r.stdout, "Markdawn updated successfully.")
	}
	if err != nil {
		return err
	}
	return nil
}

type updateResult struct {
	Updated   bool `json:"updated"`
	Scheduled bool `json:"scheduled"`
}
