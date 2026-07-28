//go:build windows

package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

func replaceUpdatedBinary(destination, staged string) (bool, error) {
	stateDir, err := installStateDir()
	if err != nil {
		return false, err
	}
	failurePath := filepath.Join(stateDir, "update-failure.txt")
	helper := filepath.Join(filepath.Dir(staged), fmt.Sprintf("update-%d.ps1", os.Getpid()))
	script := standaloneUpdateScript(os.Getpid(), destination, staged, failurePath)
	if err := os.WriteFile(helper, []byte(script), 0o600); err != nil {
		return false, err
	}
	if err := powershellCommand("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", helper).Start(); err != nil {
		return false, err
	}
	return true, nil
}

func standaloneUpdateScript(parentID int, destination, staged, failurePath string) string {
	return fmt.Sprintf(`$ErrorActionPreference = 'Stop'
$failed = $false
try {
$parent = %d
if ($parent -gt 0) {
  Wait-Process -Id $parent -ErrorAction SilentlyContinue
}
Move-Item -LiteralPath '%s' -Destination '%s' -Force -ErrorAction Stop
Remove-Item -LiteralPath '%s' -Force -ErrorAction SilentlyContinue
} catch {
$failed = $true
$failureMessage = $_.Exception.Message
if (Test-Path -LiteralPath '%s') {
  try {
    Remove-Item -LiteralPath '%s' -Force -ErrorAction Stop
  } catch {
    $failureMessage += [Environment]::NewLine + 'remove staged update: ' + $_.Exception.Message
  }
}
[IO.File]::WriteAllText('%s', 'deferred_update_failed' + [Environment]::NewLine + $failureMessage, (New-Object Text.UTF8Encoding($false)))
} finally {
Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
}
if ($failed) { exit 1 }
`, parentID, powershellLiteral(staged), powershellLiteral(destination), powershellLiteral(failurePath), powershellLiteral(staged), powershellLiteral(staged), powershellLiteral(failurePath))
}

func checkDeferredUpdateFailure() error {
	stateDir, err := installStateDir()
	if err != nil {
		return err
	}
	path := filepath.Join(stateDir, "update-failure.txt")
	failure, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read deferred update failure: %w", err)
	}
	if err := os.Remove(path); err != nil {
		return fmt.Errorf("clear deferred update failure: %w", err)
	}
	return &cliError{Code: "deferred_update_failed", Message: "previous deferred update failed", Cause: errors.New(string(failure))}
}
