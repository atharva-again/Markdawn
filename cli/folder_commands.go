package main

import (
	"fmt"
	"sort"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/lipgloss/table"
)

type FolderListCmd struct{}

type folderListItem struct {
	folder
	Path string `json:"path"`
}

func (cmd *FolderListCmd) Run(r *runtimeState) error {
	c, err := r.client()
	if err != nil {
		return err
	}
	folders, err := listFolders(c)
	if err != nil {
		return err
	}
	paths := folderPaths(folders)
	items := make([]folderListItem, 0, len(folders))
	for _, item := range folders {
		items = append(items, folderListItem{folder: item, Path: "/" + paths[item.ID]})
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Path == items[j].Path {
			return items[i].ID < items[j].ID
		}
		return items[i].Path < items[j].Path
	})
	if r.cli.JSON {
		return r.printJSON(items)
	}
	if len(items) == 0 {
		_, err := fmt.Fprintln(r.stdout, "No accessible folders.")
		return err
	}
	if !r.stdoutTTY || r.cli.Plain {
		for _, item := range items {
			if _, err := fmt.Fprintf(
				r.stdout,
				"%s\t%s\t%s\n",
				terminalText(item.ID),
				terminalText(item.Path),
				terminalText(valueOrEmpty(item.Permission)),
			); err != nil {
				return err
			}
		}
		return nil
	}
	rows := make([][]string, 0, len(items))
	for _, item := range items {
		rows = append(rows, []string{
			terminalText(item.Path),
			terminalText(valueOrEmpty(item.Permission)),
			r.style(dimStyle, terminalText(item.ID)),
		})
	}
	result := table.New().Headers("PATH", "PERMISSION", "ID").Rows(rows...).Border(lipgloss.HiddenBorder())
	_, err = fmt.Fprintln(r.stdout, result.Render())
	return err
}

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
