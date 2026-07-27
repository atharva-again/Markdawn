package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
)

type PageListCmd struct {
	Parent string `help:"Only list pages directly inside this folder ID." placeholder:"FOLDER_ID"`
	Limit  int    `help:"Maximum number of pages to return; 0 returns all pages." default:"0"`
}

type PageViewCmd struct {
	Reference string `arg:"" name:"page" help:"Page ID or exact title."`
	Raw       bool   `help:"Print authored Markdown without terminal rendering."`
}

type PageCreateCmd struct {
	Title       string `help:"Page title; defaults to Untitled." placeholder:"TITLE"`
	Parent      string `help:"Parent folder ID." placeholder:"FOLDER_ID"`
	Icon        string `help:"Set the page icon." placeholder:"ICON"`
	ContentFile string `name:"content-file" short:"f" help:"Read initial Markdown from a file, or - for stdin." placeholder:"FILE"`
}

type PageEditCmd struct {
	Interactive PageEditInteractiveCmd `cmd:"" default:"withargs" hidden:""`
	Exact       PageEditExactCmd       `cmd:"" help:"Apply an exact authored-Markdown edit."`
}

type PageEditInteractiveCmd struct {
	Reference string `arg:"" name:"page" help:"Page ID or exact title."`
	Editor    string `help:"Use this editor command instead of configured editor variables." placeholder:"COMMAND"`
}

type PageEditExactCmd struct {
	Reference      string  `arg:"" name:"page" help:"Page ID or exact title."`
	OldText        *string `help:"Exact current passage to replace." placeholder:"TEXT"`
	NewText        *string `help:"Replacement text; an empty value deletes the passage." placeholder:"TEXT"`
	OldFile        string  `help:"File containing the exact current passage, or - for stdin." placeholder:"FILE"`
	NewFile        string  `help:"File containing replacement text; an empty file deletes the passage." placeholder:"FILE"`
	ExpectEmpty    bool    `help:"Require the authored Markdown to be empty before writing the replacement."`
	EditID         string  `name:"id" help:"Caller-defined edit identifier." placeholder:"ID"`
	IdempotencyKey string  `help:"Safe-retry key for this request." placeholder:"KEY"`
}

type PageUpdateCmd struct {
	Reference string `arg:"" name:"page" help:"Page ID or exact title."`
	Title     string `help:"Set the page title." placeholder:"TITLE"`
	Icon      string `help:"Set the page icon." placeholder:"ICON"`
	ClearIcon bool   `help:"Remove the page icon."`
}

type uncertainEditDetails struct {
	IdempotencyKey string `json:"idempotencyKey"`
}

func (cmd *PageListCmd) Run(r *runtimeState) error {
	if cmd.Limit < 0 || cmd.Limit > 10000 {
		return usageError("--limit must be between 0 and 10000")
	}
	if cmd.Parent != "" && !isUUID(cmd.Parent) {
		return usageError("--parent must be a folder UUID")
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(r.ctx)
	defer cancel()
	requestClient := *c
	requestClient.ctx = ctx
	type pageResult struct {
		pages []page
		err   error
	}
	type folderResult struct {
		folders []folder
		err     error
	}
	pagesDone := make(chan pageResult, 1)
	foldersDone := make(chan folderResult, 1)
	go func() {
		pages, listErr := requestClient.listPages(cmd.Parent, cmd.Limit)
		pagesDone <- pageResult{pages: pages, err: listErr}
	}()
	go func() {
		folders, listErr := listFolders(&requestClient)
		foldersDone <- folderResult{folders: folders, err: listErr}
	}()

	var pages []page
	var folders []folder
	for pagesDone != nil || foldersDone != nil {
		select {
		case result := <-pagesDone:
			pagesDone = nil
			if result.err != nil {
				cancel()
				return result.err
			}
			pages = result.pages
		case result := <-foldersDone:
			foldersDone = nil
			if result.err != nil {
				cancel()
				return result.err
			}
			folders = result.folders
		}
	}
	paths := folderPaths(folders)
	items := make([]pageListItem, 0, len(pages))
	for _, item := range pages {
		folderPath := "/"
		if item.ParentID != nil && paths[*item.ParentID] != "" {
			folderPath = "/" + paths[*item.ParentID]
		}
		items = append(items, pageListItem{page: item, FolderPath: folderPath})
	}
	return renderPageList(r, items)
}

func (cmd *PageViewCmd) Run(r *runtimeState) error {
	selected, err := r.resolvePage(cmd.Reference)
	if err != nil {
		return err
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	content, etag, err := c.getPageContent(selected.ID)
	if err != nil {
		return err
	}
	return renderPageView(r, selected, content, etag, cmd.Raw)
}

func (cmd *PageCreateCmd) Run(r *runtimeState) error {
	if cmd.Parent != "" && !isUUID(cmd.Parent) {
		return usageError("--parent must be a folder UUID")
	}
	request := createPageRequest{}
	if cmd.Title != "" {
		request.Title = &cmd.Title
	}
	if cmd.Parent != "" {
		request.ParentID = &cmd.Parent
	}
	if cmd.Icon != "" {
		request.Icon = &cmd.Icon
	}
	if cmd.ContentFile != "" {
		content, err := readContentFile(cmd.ContentFile, r.stdin)
		if err != nil {
			return err
		}
		markdown := string(content)
		request.Markdown = &markdown
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	created, err := c.createPage(request)
	if err != nil {
		return err
	}
	if r.cli.JSON {
		return r.printJSON(created)
	}
	_, err = fmt.Fprintf(
		r.stdout,
		"Created %s  %s\n",
		terminalText(created.Title),
		r.style(dimStyle, terminalText(created.ID)),
	)
	return err
}

func (cmd *PageEditInteractiveCmd) Run(r *runtimeState) error {
	selected, err := r.resolvePage(cmd.Reference)
	if err != nil {
		return err
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	content, etag, err := c.getPageContent(selected.ID)
	if err != nil {
		return err
	}
	updated, changed, err := editPageInEditor(r, selected.Title, content, cmd.Editor)
	if err != nil {
		return err
	}
	if !changed {
		if r.cli.JSON {
			return r.printJSON(pageEditResult{Changed: false, Page: selected})
		}
		_, err = fmt.Fprintln(r.stdout, "No changes.")
		return err
	}
	updatedEtag, err := c.replacePageContent(selected.ID, updated, etag)
	if err != nil {
		return err
	}
	if r.cli.JSON {
		return r.printJSON(pageEditResult{Changed: true, Page: selected, ETag: updatedEtag})
	}
	_, err = fmt.Fprintf(r.stdout, "Saved %s\n", terminalText(selected.Title))
	return err
}

func updatePage(r *runtimeState, reference string, request updatePageRequest) (page, error) {
	selected, err := r.resolvePage(reference)
	if err != nil {
		return page{}, err
	}
	c, err := r.client()
	if err != nil {
		return page{}, err
	}
	return c.updatePage(selected.ID, request)
}

func (cmd *PageUpdateCmd) Run(r *runtimeState) error {
	if cmd.Title == "" && cmd.Icon == "" && !cmd.ClearIcon {
		return usageError("provide --title, --icon, or --clear-icon")
	}
	if cmd.Icon != "" && cmd.ClearIcon {
		return usageError("--icon and --clear-icon cannot be used together")
	}
	request := updatePageRequest{}
	if cmd.Title != "" {
		request.Title = &cmd.Title
	}
	if cmd.Icon != "" {
		request.Icon = &cmd.Icon
	} else if cmd.ClearIcon {
		request.ClearIcon = true
	}
	updated, err := updatePage(r, cmd.Reference, request)
	if err != nil {
		return err
	}
	if r.cli.JSON {
		return r.printJSON(updated)
	}
	_, err = fmt.Fprintf(
		r.stdout,
		"Updated %s  %s\n",
		terminalText(updated.Title),
		r.style(dimStyle, terminalText(updated.ID)),
	)
	return err
}

func (cmd *PageEditExactCmd) Run(r *runtimeState) error {
	if cmd.OldFile == "-" && cmd.NewFile == "-" {
		return usageError("only one replacement file may read from stdin")
	}
	var oldText []byte
	var err error
	if cmd.ExpectEmpty {
		if cmd.OldText != nil || cmd.OldFile != "" {
			return usageError("--expect-empty cannot be used with --old-text or --old-file")
		}
	} else {
		oldText, err = replacementInput(cmd.OldText, cmd.OldFile, r.stdin, "old")
		if err != nil {
			return err
		}
		if len(oldText) == 0 {
			return usageError("empty old content requires --expect-empty")
		}
	}
	newText, err := replacementInput(cmd.NewText, cmd.NewFile, r.stdin, "new")
	if err != nil {
		return err
	}
	editID := cmd.EditID
	if editID == "" {
		editID, err = randomRequestID()
		if err != nil {
			return err
		}
	}
	idempotencyKey := cmd.IdempotencyKey
	generatedIdempotencyKey := idempotencyKey == ""
	if idempotencyKey == "" {
		idempotencyKey, err = randomRequestID()
		if err != nil {
			return err
		}
	}
	selected, err := r.resolvePage(cmd.Reference)
	if err != nil {
		return err
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	result, err := c.applyPageExactEdit(selected.ID, exactEdit{
		ID: editID, OldText: string(oldText), NewText: string(newText),
	}, idempotencyKey)
	if err != nil {
		if generatedIdempotencyKey &&
			(errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled)) {
			return &cliError{
				Code: "edit_outcome_uncertain",
				Message: fmt.Sprintf(
					"exact edit outcome is uncertain; retry with --idempotency-key %s",
					idempotencyKey,
				),
				Details: uncertainEditDetails{IdempotencyKey: idempotencyKey},
				Cause:   err,
			}
		}
		return err
	}
	if len(result.Results) != 1 || result.Results[0].Status != "applied" {
		reason := "edit was not applied"
		if len(result.Results) == 1 && result.Results[0].Reason != "" {
			reason = result.Results[0].Reason
		}
		return &cliError{Code: "edit_conflict", Message: reason, StatusCode: http.StatusConflict, Details: result}
	}
	if r.cli.JSON {
		return r.printJSON(result)
	}
	_, err = fmt.Fprintf(r.stdout, "Applied exact edit %s\n", terminalText(editID))
	return err
}
