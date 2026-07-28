package main

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"

	"github.com/charmbracelet/huh"
)

type pageCandidate struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Path  string `json:"folderPath"`
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
