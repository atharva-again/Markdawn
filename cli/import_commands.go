package main

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

type ImportPageCmd struct {
	Path string `arg:"" name:"file" help:"Markdown file to import at the workspace root."`
}

type ImportFolderCmd struct {
	Path string `arg:"" name:"folder" help:"Folder or Obsidian vault to import at the workspace root."`
	Yes  bool   `short:"y" help:"Skip the import preview confirmation."`
}

type importedVaultFile struct {
	Path     string  `json:"path"`
	Content  *string `json:"content,omitempty"`
	Data     string  `json:"data,omitempty"`
	MIMEType string  `json:"mimeType,omitempty"`
}

type importPreview struct {
	Notes   int `json:"notes"`
	Images  int `json:"images"`
	Folders int `json:"folders"`
}

type importResult struct {
	FoldersCreated   int      `json:"foldersCreated"`
	PagesCreated     int      `json:"pagesCreated"`
	ImagesUploaded   int      `json:"imagesUploaded"`
	BacklinksCreated int      `json:"backlinksCreated"`
	Errors           []string `json:"errors"`
}

type markdownImportWarning struct {
	Code    string `json:"code"`
	Count   int    `json:"count"`
	Message string `json:"message"`
}

type markdownImportResult struct {
	Page struct {
		ID    string `json:"id"`
		Title string `json:"title"`
	} `json:"page"`
	Warnings []markdownImportWarning `json:"warnings"`
}

func isMarkdownImportFile(path string) bool {
	return strings.EqualFold(filepath.Ext(path), ".md")
}

func (cmd *ImportPageCmd) Run(r *runtimeState) error {
	if !isMarkdownImportFile(cmd.Path) {
		return usageError("Import page requires a Markdown (.md) file.")
	}
	content, err := os.ReadFile(cmd.Path)
	if err != nil {
		return fmt.Errorf("read Markdown file: %w", err)
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", filepath.Base(cmd.Path))
	if err != nil {
		return fmt.Errorf("create import form: %w", err)
	}
	if _, err := part.Write(content); err != nil {
		return fmt.Errorf("write import form: %w", err)
	}
	if err := writer.Close(); err != nil {
		return fmt.Errorf("finalize import form: %w", err)
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	response, err := c.request(
		http.MethodPost,
		"/imports/markdown",
		body.Bytes(),
		map[string]string{"Content-Type": writer.FormDataContentType()},
	)
	if err != nil {
		return uncertainLifecycleMutationOutcome(err)
	}
	var result markdownImportResult
	if err := decodeJSON(response, &result); err != nil {
		return uncertainLifecycleMutationOutcome(err)
	}
	if r.cli.JSON {
		return r.printJSON(result)
	}
	if _, err := fmt.Fprintln(r.stdout, "Markdown page imported."); err != nil {
		return err
	}
	for _, warning := range result.Warnings {
		if _, err := fmt.Fprintf(
			r.stderr,
			"Warning [%s]: %s\n",
			terminalText(warning.Code),
			terminalText(warning.Message),
		); err != nil {
			return err
		}
	}
	return nil
}

func scanImportFolder(root string) ([]importedVaultFile, importPreview, error) {
	info, err := os.Lstat(root)
	if err != nil {
		return nil, importPreview{}, fmt.Errorf("inspect import folder: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return nil, importPreview{}, usageError("Import folder must not be a symbolic link.")
	}
	if !info.IsDir() {
		return nil, importPreview{}, usageError("Import folder requires a directory.")
	}
	files := make([]importedVaultFile, 0)
	folderPaths := make(map[string]struct{})
	preview := importPreview{}
	err = filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("symbolic links are not supported in import folders: %s", path)
		}
		if entry.IsDir() {
			if entry.Name() == ".obsidian" {
				return filepath.SkipDir
			}
			return nil
		}
		relativePath, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		relativePath = filepath.ToSlash(relativePath)
		directory := filepath.ToSlash(filepath.Dir(relativePath))
		addDirectory := func() {
			if directory == "." {
				return
			}
			parts := strings.Split(directory, "/")
			for index := range parts {
				folderPaths[strings.Join(parts[:index+1], "/")] = struct{}{}
			}
		}
		if isMarkdownImportFile(entry.Name()) {
			content, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			addDirectory()
			markdown := string(content)
			files = append(files, importedVaultFile{Path: relativePath, Content: &markdown})
			preview.Notes++
			return nil
		}
		extension := strings.ToLower(filepath.Ext(entry.Name()))
		mimeType := ""
		switch extension {
		case ".jpg", ".jpeg":
			mimeType = "image/jpeg"
		case ".png":
			mimeType = "image/png"
		case ".gif":
			mimeType = "image/gif"
		case ".webp":
			mimeType = "image/webp"
		case ".svg":
			mimeType = "image/svg+xml"
		default:
			return nil
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		addDirectory()
		files = append(files, importedVaultFile{
			Path: relativePath, Data: base64.StdEncoding.EncodeToString(content), MIMEType: mimeType,
		})
		preview.Images++
		return nil
	})
	if err != nil {
		return nil, importPreview{}, fmt.Errorf("scan import folder: %w", err)
	}
	preview.Folders = len(folderPaths)
	if len(files) == 0 {
		return nil, importPreview{}, usageError("Import folder contains no Markdown files or images.")
	}
	return files, preview, nil
}

func (cmd *ImportFolderCmd) Run(r *runtimeState) error {
	files, preview, err := scanImportFolder(cmd.Path)
	if err != nil {
		return err
	}
	if !r.cli.JSON {
		if _, err := fmt.Fprintf(
			r.stdout,
			"Found %s, %s, and %s.\n",
			countLabel(int64(preview.Notes), "Markdown file", "Markdown files"),
			countLabel(int64(preview.Images), "image", "images"),
			countLabel(int64(preview.Folders), "folder", "folders"),
		); err != nil {
			return err
		}
	}
	if err := confirmLifecycleAction(r, cmd.Yes, "Import this folder into the workspace root?"); err != nil {
		return err
	}
	body, err := marshalBody(struct {
		Files []importedVaultFile `json:"files"`
	}{Files: files})
	if err != nil {
		return err
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	response, err := c.request(
		http.MethodPost,
		"/imports/obsidian",
		body,
		map[string]string{"Content-Type": "application/json"},
	)
	if err != nil {
		return uncertainLifecycleMutationOutcome(err)
	}
	var result importResult
	if err := decodeJSON(response, &result); err != nil {
		return uncertainLifecycleMutationOutcome(err)
	}
	if r.cli.JSON {
		return r.printJSON(struct {
			Preview importPreview `json:"preview"`
			Result  importResult  `json:"result"`
		}{Preview: preview, Result: result})
	}
	if _, err := fmt.Fprintf(
		r.stdout,
		"Imported %s, %s, and %s.\n",
		countLabel(int64(result.FoldersCreated), "folder", "folders"),
		countLabel(int64(result.PagesCreated), "page", "pages"),
		countLabel(int64(result.ImagesUploaded), "image", "images"),
	); err != nil {
		return err
	}
	for _, warning := range result.Errors {
		if _, err := fmt.Fprintf(r.stderr, "Warning: %s\n", terminalText(warning)); err != nil {
			return err
		}
	}
	return nil
}
