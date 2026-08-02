package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type ExportPageCmd struct {
	Reference string `arg:"" name:"page" help:"Page ID or exact title."`
	Output    string `short:"o" help:"Write the export to this file instead of stdout." placeholder:"FILE"`
	Force     bool   `help:"Overwrite an existing output file."`
}

type ExportAllCmd struct {
	Output string `short:"o" required:"" help:"Write the ZIP export to this file." placeholder:"FILE"`
	Force  bool   `help:"Overwrite an existing output file."`
}

type pageExportJSON struct {
	Page    page    `json:"page"`
	Format  string  `json:"format"`
	Content *string `json:"content,omitempty"`
	Output  *string `json:"output,omitempty"`
	Bytes   int64   `json:"bytes"`
}

type exportAllJSON struct {
	Output string `json:"output"`
	Bytes  int64  `json:"bytes"`
}

func createExportFile(path string, force bool) (*os.File, string, bool, error) {
	if force {
		file, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".tmp-*")
		if err != nil {
			return nil, "", false, fmt.Errorf("create export staging file: %w", err)
		}
		return file, file.Name(), true, nil
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		if os.IsExist(err) {
			return nil, "", false, usageError("output file %q already exists; pass --force to overwrite it", path)
		}
		return nil, "", false, fmt.Errorf("create export file: %w", err)
	}
	return file, path, false, nil
}

func cleanupIncompleteExport(stagingPath string, operationErr error) error {
	if err := os.Remove(stagingPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("write export and remove incomplete file: %w", errors.Join(operationErr, err))
	}
	return fmt.Errorf("write export: %w", operationErr)
}

func streamExportFile(path string, source io.Reader, force bool) (int64, error) {
	file, stagingPath, replaceOnSuccess, err := createExportFile(path, force)
	if err != nil {
		return 0, err
	}
	bytes, copyErr := io.Copy(file, source)
	closeErr := file.Close()
	if copyErr != nil {
		return 0, cleanupIncompleteExport(stagingPath, errors.Join(copyErr, closeErr))
	}
	if closeErr != nil {
		return 0, cleanupIncompleteExport(stagingPath, closeErr)
	}
	if replaceOnSuccess {
		if err := os.Rename(stagingPath, path); err != nil {
			return 0, cleanupIncompleteExport(stagingPath, err)
		}
	}
	return bytes, nil
}

func (cmd *ExportPageCmd) Run(r *runtimeState) error {
	selected, err := r.resolvePage(cmd.Reference)
	if err != nil {
		return err
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	response, err := c.request(
		"GET",
		"/pages/"+selected.ID+"/export/markdown",
		nil,
		nil,
	)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	format := "markdown"
	if strings.HasPrefix(strings.ToLower(response.Header.Get("Content-Type")), "application/zip") {
		format = "zip"
	}
	if format == "zip" && cmd.Output == "" {
		return usageError("this page export contains attachments; pass --output FILE.zip")
	}
	if cmd.Output == "" {
		if r.cli.JSON {
			content, err := io.ReadAll(response.Body)
			if err != nil {
				return fmt.Errorf("read export: %w", err)
			}
			markdown := string(content)
			return r.printJSON(pageExportJSON{Page: selected, Format: format, Content: &markdown, Bytes: int64(len(content))})
		}
		if _, err := io.Copy(r.stdout, response.Body); err != nil {
			return fmt.Errorf("write export: %w", err)
		}
		return nil
	}
	bytes, err := streamExportFile(cmd.Output, response.Body, cmd.Force)
	if err != nil {
		return err
	}
	absPath, err := filepath.Abs(cmd.Output)
	if err != nil {
		return fmt.Errorf("resolve output path: %w", err)
	}
	if r.cli.JSON {
		result := pageExportJSON{Page: selected, Format: format, Output: &absPath, Bytes: bytes}
		if format == "markdown" {
			// JSON output historically includes Markdown even when --output is
			// supplied. Archives never take this path; they are streamed directly.
			content, err := os.ReadFile(cmd.Output)
			if err != nil {
				return fmt.Errorf("read export file: %w", err)
			}
			markdown := string(content)
			result.Content = &markdown
		}
		return r.printJSON(result)
	}
	_, err = fmt.Fprintf(r.stdout, "Exported %d bytes to %s\n", bytes, terminalText(absPath))
	return err
}

func (cmd *ExportAllCmd) Run(r *runtimeState) error {
	c, err := r.client()
	if err != nil {
		return err
	}
	response, err := c.request("GET", "/exports/workspace", nil, nil)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	bytes, err := streamExportFile(cmd.Output, response.Body, cmd.Force)
	if err != nil {
		return err
	}
	absPath, err := filepath.Abs(cmd.Output)
	if err != nil {
		return fmt.Errorf("resolve output path: %w", err)
	}
	if r.cli.JSON {
		return r.printJSON(exportAllJSON{Output: absPath, Bytes: bytes})
	}
	_, err = fmt.Fprintf(r.stdout, "Exported %d bytes to %s\n", bytes, terminalText(absPath))
	return err
}
