package main

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"github.com/charmbracelet/huh"
)

type pageCandidate struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Path  string `json:"folderPath"`
}

type folderCandidate struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Path string `json:"folderPath"`
}

func isUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for index, char := range value {
		if index == 8 || index == 13 || index == 18 || index == 23 {
			if char != '-' {
				return false
			}
			continue
		}
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F')) {
			return false
		}
	}
	return true
}

func listFolders(c *client) ([]folder, error) {
	folders := make([]folder, 0, 100)
	cursor := ""
	for {
		path := "/folders?limit=100"
		if cursor != "" {
			path += "&cursor=" + url.QueryEscape(cursor)
		}
		response, err := c.request(http.MethodGet, path, nil, nil)
		if err != nil {
			return nil, err
		}
		var result folderList
		if err := decodeJSON(response, &result); err != nil {
			return nil, err
		}
		folders = append(folders, result.Data...)
		if result.NextCursor == nil || len(result.Data) == 0 {
			return folders, nil
		}
		cursor = *result.NextCursor
	}
}

func folderPaths(folders []folder) map[string]string {
	byID := make(map[string]folder, len(folders))
	for _, item := range folders {
		byID[item.ID] = item
	}
	result := make(map[string]string, len(folders))
	var visit func(string, map[string]bool) string
	visit = func(id string, visiting map[string]bool) string {
		if path, ok := result[id]; ok {
			return path
		}
		item, ok := byID[id]
		if !ok {
			return ""
		}
		if visiting[id] {
			return item.Name
		}
		visiting[id] = true
		path := item.Name
		if item.ParentID != nil {
			if parent := visit(*item.ParentID, visiting); parent != "" {
				path = parent + "/" + path
			}
		}
		delete(visiting, id)
		result[id] = path
		return path
	}
	for id := range byID {
		visit(id, map[string]bool{})
	}
	return result
}

func (r *runtimeState) resolvePage(reference string) (page, error) {
	c, err := r.client()
	if err != nil {
		return page{}, err
	}
	if isUUID(reference) {
		return c.getPage(reference)
	}
	resolved, err := c.resolvePagesByTitle(reference)
	if err != nil {
		return page{}, err
	}
	if len(resolved) == 0 {
		return page{}, &cliError{Code: "page_not_found", Message: fmt.Sprintf("no page titled %q", reference), StatusCode: http.StatusNotFound}
	}
	if len(resolved) == 1 {
		return resolved[0].page, nil
	}
	candidates := make([]pageCandidate, 0, len(resolved))
	for _, match := range resolved {
		candidates = append(candidates, pageCandidate{
			ID: match.ID, Title: match.Title, Path: match.FolderPath,
		})
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].Path == candidates[j].Path {
			return candidates[i].ID < candidates[j].ID
		}
		return candidates[i].Path < candidates[j].Path
	})
	if !r.interactive() {
		return page{}, &ambiguousPageError{Reference: reference, Candidates: candidates}
	}
	byID := make(map[string]page, len(resolved))
	options := make([]huh.Option[string], 0, len(candidates))
	for _, match := range resolved {
		byID[match.ID] = match.page
	}
	for _, candidate := range candidates {
		options = append(options, huh.NewOption(
			terminalText(candidate.Path)+"  "+terminalText(candidate.ID),
			candidate.ID,
		))
	}
	selectedID := ""
	selectPage := huh.NewSelect[string]().Title("Multiple pages have that title").Options(options...).Value(&selectedID)
	err = huh.NewForm(huh.NewGroup(selectPage)).WithInput(r.stdin).WithOutput(r.stderr).RunWithContext(r.ctx)
	if err != nil {
		if errors.Is(err, huh.ErrUserAborted) {
			return page{}, &cliError{Code: "aborted", Message: "selection cancelled"}
		}
		return page{}, err
	}
	return byID[selectedID], nil
}

func (r *runtimeState) resolveFolder(reference string) (folder, error) {
	c, err := r.client()
	if err != nil {
		return folder{}, err
	}
	if isUUID(reference) {
		return c.getFolder(reference)
	}
	resolved, err := c.resolveFoldersByName(reference)
	if err != nil {
		return folder{}, err
	}
	if len(resolved) == 0 {
		return folder{}, &cliError{
			Code:       "folder_not_found",
			Message:    fmt.Sprintf("no folder named %q", reference),
			StatusCode: http.StatusNotFound,
		}
	}
	if len(resolved) == 1 {
		return resolved[0].folder, nil
	}
	candidates := make([]folderCandidate, 0, len(resolved))
	byID := make(map[string]folder, len(resolved))
	for _, match := range resolved {
		candidates = append(candidates, folderCandidate{
			ID: match.ID, Name: match.Name, Path: match.FolderPath,
		})
		byID[match.ID] = match.folder
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].Path == candidates[j].Path {
			return candidates[i].ID < candidates[j].ID
		}
		return candidates[i].Path < candidates[j].Path
	})
	if !r.interactive() {
		return folder{}, &cliError{
			Code:       "folder_ambiguous",
			Message:    fmt.Sprintf("multiple folders are named %q; use an ID", reference),
			StatusCode: http.StatusConflict,
			Details:    candidates,
		}
	}
	options := make([]huh.Option[string], 0, len(candidates))
	for _, candidate := range candidates {
		options = append(options, huh.NewOption(
			terminalText(candidate.Path)+"  "+terminalText(candidate.ID),
			candidate.ID,
		))
	}
	selectedID := ""
	selectFolder := huh.NewSelect[string]().Title("Multiple folders have that name").Options(options...).Value(&selectedID)
	err = huh.NewForm(huh.NewGroup(selectFolder)).WithInput(r.stdin).WithOutput(r.stderr).RunWithContext(r.ctx)
	if err != nil {
		if errors.Is(err, huh.ErrUserAborted) {
			return folder{}, &cliError{Code: "aborted", Message: "selection cancelled"}
		}
		return folder{}, err
	}
	return byID[selectedID], nil
}

func (r *runtimeState) resolveTrashedPage(reference string) (page, error) {
	c, err := r.client()
	if err != nil {
		return page{}, err
	}
	pages, err := c.listTrashedPages()
	if err != nil {
		return page{}, err
	}
	return r.resolveTrashedPageFromSnapshot(reference, pages)
}

func (r *runtimeState) resolveTrashedPageFromSnapshot(reference string, pages []page) (page, error) {
	matches := make([]page, 0, 1)
	for _, item := range pages {
		if isUUID(reference) && item.ID == reference || (!isUUID(reference) && strings.EqualFold(item.Title, reference)) {
			matches = append(matches, item)
		}
	}
	if len(matches) == 0 {
		return page{}, &cliError{Code: "page_not_found", Message: fmt.Sprintf("no trashed page titled %q", reference), StatusCode: http.StatusNotFound}
	}
	if len(matches) == 1 {
		return matches[0], nil
	}
	if !r.interactive() {
		return page{}, &cliError{Code: "page_ambiguous", Message: fmt.Sprintf("multiple trashed pages are named %q; use an ID", reference), StatusCode: http.StatusConflict}
	}
	options := make([]huh.Option[string], 0, len(matches))
	byID := make(map[string]page, len(matches))
	for _, item := range matches {
		byID[item.ID] = item
		options = append(options, huh.NewOption(terminalText(item.Title)+"  "+terminalText(item.ID), item.ID))
	}
	selectedID := ""
	selectPage := huh.NewSelect[string]().Title("Multiple trashed pages have that title").Options(options...).Value(&selectedID)
	if err := huh.NewForm(huh.NewGroup(selectPage)).WithInput(r.stdin).WithOutput(r.stderr).RunWithContext(r.ctx); err != nil {
		return page{}, err
	}
	return byID[selectedID], nil
}

func (r *runtimeState) resolveTrashedFolder(reference string) (folder, error) {
	c, err := r.client()
	if err != nil {
		return folder{}, err
	}
	folders, err := c.listTrashedFolders()
	if err != nil {
		return folder{}, err
	}
	return r.resolveTrashedFolderFromSnapshot(reference, folders)
}

func (r *runtimeState) resolveTrashedFolderFromSnapshot(reference string, folders []folder) (folder, error) {
	matches := make([]folder, 0, 1)
	for _, item := range folders {
		if isUUID(reference) && item.ID == reference || (!isUUID(reference) && strings.EqualFold(item.Name, reference)) {
			matches = append(matches, item)
		}
	}
	if len(matches) == 0 {
		return folder{}, &cliError{Code: "folder_not_found", Message: fmt.Sprintf("no trashed folder named %q", reference), StatusCode: http.StatusNotFound}
	}
	if len(matches) == 1 {
		return matches[0], nil
	}
	if !r.interactive() {
		return folder{}, &cliError{Code: "folder_ambiguous", Message: fmt.Sprintf("multiple trashed folders are named %q; use an ID", reference), StatusCode: http.StatusConflict}
	}
	options := make([]huh.Option[string], 0, len(matches))
	byID := make(map[string]folder, len(matches))
	for _, item := range matches {
		byID[item.ID] = item
		options = append(options, huh.NewOption(terminalText(item.Name)+"  "+terminalText(item.ID), item.ID))
	}
	selectedID := ""
	selectFolder := huh.NewSelect[string]().Title("Multiple trashed folders have that name").Options(options...).Value(&selectedID)
	if err := huh.NewForm(huh.NewGroup(selectFolder)).WithInput(r.stdin).WithOutput(r.stderr).RunWithContext(r.ctx); err != nil {
		return folder{}, err
	}
	return byID[selectedID], nil
}
