package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/charmbracelet/huh"
)

func (cmd *UninstallCmd) Run(r *runtimeState) error {
	receipt, receiptPath, err := managedInstall()
	if err != nil {
		return err
	}
	configPathValue := ""
	if cmd.Purge {
		configPathValue, err = configPath()
		if err != nil {
			return err
		}
	}
	if cmd.DryRun {
		return printUninstallPlan(r, receipt, receiptPath, configPathValue)
	}
	if !cmd.Yes {
		if !r.interactive() {
			return usageError("uninstall requires confirmation; pass --yes when terminal input is disabled")
		}
		confirmed, err := confirmUninstall(r)
		if err != nil {
			return err
		}
		if !confirmed {
			return &cliError{Code: "aborted", Message: "uninstall cancelled"}
		}
	}
	var restorePathBlock func() error
	if cmd.RemovePath && receipt.PathFile != "" {
		restorePathBlock, err = removePathBlockAndUpdateReceipt(receipt.PathFile, receipt.InstallDir, receiptPath, receipt)
		if err != nil {
			return err
		}
	}
	deferred, err := removeStandaloneBinary(receipt.BinaryPath, receiptPath, "", receipt.InstallDir, configPathValue)
	if err != nil {
		if restorePathBlock != nil {
			if restoreErr := restorePathBlock(); restoreErr != nil {
				return fmt.Errorf("remove standalone installation: %w; restore installer PATH block: %v", err, restoreErr)
			}
		}
		return err
	}
	if r.cli.JSON {
		return r.printJSON(uninstallResult{Uninstalled: !deferred, Scheduled: deferred})
	}
	if deferred {
		_, err = fmt.Fprintln(r.stdout, "Markdawn uninstall is scheduled and will finish after this command exits.")
		return err
	}
	_, err = fmt.Fprintln(r.stdout, "Markdawn uninstalled.")
	return err
}

func removeStandaloneConfig(path string) error {
	if path == "" {
		return nil
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove Markdawn configuration: %w", err)
	}
	if os.Getenv("MARKDAWN_CONFIG_DIR") == "" {
		if err := os.Remove(filepath.Dir(path)); err != nil && !errors.Is(err, os.ErrNotExist) && !errors.Is(err, syscallENOTEMPTY()) {
			return fmt.Errorf("remove Markdawn configuration directory: %w", err)
		}
	}
	return nil
}

func printUninstallPlan(r *runtimeState, receipt installReceipt, receiptPath, configPathValue string) error {
	paths := []string{receipt.BinaryPath, receiptPath}
	if configPathValue != "" {
		paths = append(paths, configPathValue)
	}
	if receipt.PathFile != "" && r.cli != nil && r.cli.Uninstall.RemovePath {
		paths = append(paths, receipt.PathFile+" (installer PATH block)")
	}
	if r.cli.JSON {
		return r.printJSON(uninstallPlan{DryRun: true, Paths: paths})
	}
	for _, path := range paths {
		if _, err := fmt.Fprintln(r.stdout, "Would remove:", path); err != nil {
			return err
		}
	}
	return nil
}

type uninstallResult struct {
	Uninstalled bool `json:"uninstalled"`
	Scheduled   bool `json:"scheduled"`
}

type uninstallPlan struct {
	DryRun bool     `json:"dryRun"`
	Paths  []string `json:"paths"`
}

func confirmUninstall(r *runtimeState) (bool, error) {
	confirmed := false
	form := huh.NewForm(huh.NewGroup(huh.NewConfirm().Title("Remove this standalone Markdawn installation?").Value(&confirmed)))
	err := form.WithInput(r.stdin).WithOutput(r.stderr).RunWithContext(r.ctx)
	if errors.Is(err, huh.ErrUserAborted) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return confirmed, nil
}

func removePathBlockAndUpdateReceipt(path, installDir, receiptPath string, receipt installReceipt) (func() error, error) {
	originalReceipt, err := os.ReadFile(receiptPath)
	if err != nil {
		return nil, fmt.Errorf("read standalone install receipt for rollback: %w", err)
	}
	restorePath, err := removePathBlockWithRollback(path, installDir)
	if err != nil {
		return nil, err
	}
	receipt.PathFile = ""
	data, err := json.MarshalIndent(receipt, "", "  ")
	if err == nil {
		err = writePrivateFileAtomically(receiptPath, append(data, '\n'))
	}
	if err == nil {
		return func() error {
			if restoreErr := restorePath(); restoreErr != nil {
				return fmt.Errorf("restore installer PATH block: %w", restoreErr)
			}
			if restoreErr := writePrivateFileAtomically(receiptPath, originalReceipt); restoreErr != nil {
				return fmt.Errorf("restore standalone install receipt: %w", restoreErr)
			}
			return nil
		}, nil
	}
	if restoreErr := restorePath(); restoreErr != nil {
		return nil, fmt.Errorf("update standalone install receipt after PATH cleanup: %w; restore installer PATH block: %v", err, restoreErr)
	}
	return nil, fmt.Errorf("update standalone install receipt after PATH cleanup: %w", err)
}
