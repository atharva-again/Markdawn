package main

import (
	"fmt"

	"github.com/charmbracelet/glamour"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/lipgloss/table"
)

var (
	headingStyle = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("12"))
	dimStyle     = lipgloss.NewStyle().Foreground(lipgloss.Color("8"))
)

type pageViewResult struct {
	Page     page   `json:"page"`
	Markdown string `json:"markdown"`
	ETag     string `json:"etag"`
}

type pageEditResult struct {
	Changed bool   `json:"changed"`
	Page    page   `json:"page"`
	ETag    string `json:"etag,omitempty"`
}

type pageListItem struct {
	page
	FolderPath string `json:"folderPath"`
}

func renderPageList(r *runtimeState, items []pageListItem) error {
	if r.cli.JSON {
		return r.printJSON(items)
	}
	if len(items) == 0 {
		_, err := fmt.Fprintln(r.stdout, "No accessible pages.")
		return err
	}
	if !r.stdoutTTY || r.cli.Plain {
		for _, item := range items {
			updated := ""
			if item.UpdatedAt != nil {
				updated = *item.UpdatedAt
			}
			if _, err := fmt.Fprintf(
				r.stdout,
				"%s\t%s\t%s\t%s\n",
				terminalText(item.ID),
				terminalText(item.Title),
				terminalText(item.FolderPath),
				terminalText(updated),
			); err != nil {
				return err
			}
		}
		return nil
	}
	rows := make([][]string, 0, len(items))
	for _, item := range items {
		updated := ""
		if item.UpdatedAt != nil {
			updated = *item.UpdatedAt
		}
		rows = append(rows, []string{
			terminalText(item.Title),
			terminalText(item.FolderPath),
			terminalText(updated),
			r.style(dimStyle, terminalText(item.ID)),
		})
	}
	result := table.New().Headers("TITLE", "FOLDER", "UPDATED", "ID").Rows(rows...).Border(lipgloss.HiddenBorder())
	_, err := fmt.Fprintln(r.stdout, result.Render())
	return err
}

func renderPageView(r *runtimeState, selected page, content []byte, etag string, raw bool) error {
	if r.cli.JSON {
		return r.printJSON(pageViewResult{Page: selected, Markdown: string(content), ETag: etag})
	}
	if raw || r.cli.Plain || !r.stdoutTTY {
		_, err := r.stdout.Write(content)
		return err
	}
	if _, err := fmt.Fprintln(r.stdout, r.style(headingStyle, terminalText(selected.Title))); err != nil {
		return err
	}
	renderer, err := glamour.NewTermRenderer(glamour.WithAutoStyle(), glamour.WithWordWrap(100))
	if err != nil {
		return err
	}
	rendered, err := renderer.Render(string(content))
	if err != nil {
		return err
	}
	_, err = fmt.Fprint(r.stdout, rendered)
	return err
}
