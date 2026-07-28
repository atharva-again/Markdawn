//go:build windows

package main

import (
	"errors"
	"fmt"
	"os"
)

func preparePrivateFileReplacement(path, temporaryPath string) error {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("inspect existing private file security: %w", err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("existing private file is not a regular file")
	}
	script := fmt.Sprintf(`$ErrorActionPreference = 'Stop'
$acl = Get-Acl -LiteralPath '%s'
Set-Acl -LiteralPath '%s' -AclObject $acl
`, powershellLiteral(path), powershellLiteral(temporaryPath))
	output, err := powershellCommand("-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script).CombinedOutput()
	if err != nil {
		return fmt.Errorf("copy private file ACL: %w: %s", err, output)
	}
	return nil
}
