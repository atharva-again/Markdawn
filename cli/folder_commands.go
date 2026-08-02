package main

import (
	"fmt"
	"sort"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/lipgloss/table"
)

type FolderListCmd struct{}

type FolderCreateCmd struct {
	Name   string `help:"Folder name; defaults to New Folder." placeholder:"NAME"`
	Parent string `help:"Parent folder ID." placeholder:"FOLDER_ID"`
}

type FolderUpdateCmd struct {
	Reference string `arg:"" name:"folder" help:"Folder ID or exact name."`
	Name      string `help:"Set the folder name." placeholder:"NAME"`
}

type FolderMoveCmd struct {
	References []string `arg:"" required:"" name:"folders" help:"Folder IDs or exact names."`
	Parent     string   `help:"Destination folder ID; omit for workspace root." placeholder:"FOLDER_ID"`
}

type FolderCopyCmd struct {
	References []string `arg:"" required:"" name:"folders" help:"Folder IDs or exact names."`
	Parent     string   `help:"Destination folder ID; omit for workspace root." placeholder:"FOLDER_ID"`
}

type FolderDeleteCmd struct {
	References []string `arg:"" required:"" name:"folders" help:"Folder IDs or exact names."`
	Yes        bool     `short:"y" help:"Skip the Trash confirmation."`
}

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

func (cmd *FolderCreateCmd) Run(r *runtimeState) error {
	if cmd.Parent != "" && !isUUID(cmd.Parent) {
		return usageError("--parent must be a folder UUID")
	}
	request := createFolderRequest{}
	if cmd.Name != "" {
		request.Name = &cmd.Name
	}
	if cmd.Parent != "" {
		request.ParentID = &cmd.Parent
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	created, err := c.createFolder(request)
	if err != nil {
		return uncertainLifecycleMutationOutcome(err)
	}
	if r.cli.JSON {
		return r.printJSON(created)
	}
	_, err = fmt.Fprintf(
		r.stdout,
		"Created %s  %s\n",
		terminalText(created.Name),
		r.style(dimStyle, terminalText(created.ID)),
	)
	return err
}

func (cmd *FolderUpdateCmd) Run(r *runtimeState) error {
	if cmd.Name == "" {
		return usageError("provide --name")
	}
	selected, err := r.resolveFolder(cmd.Reference)
	if err != nil {
		return err
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	updated, err := c.updateFolder(selected.ID, updateFolderRequest{Name: &cmd.Name})
	if err != nil {
		return err
	}
	if r.cli.JSON {
		return r.printJSON(updated)
	}
	_, err = fmt.Fprintf(
		r.stdout,
		"Updated %s  %s\n",
		terminalText(updated.Name),
		r.style(dimStyle, terminalText(updated.ID)),
	)
	return err
}

func (cmd *FolderMoveCmd) Run(r *runtimeState) error {
	parent, err := pageDestination(cmd.Parent)
	if err != nil {
		return err
	}
	return runFolderLifecycleBatch(r, cmd.References, func(c *client, folderID string) (lifecycleActionResult, error) {
		_, moveErr := c.moveFolder(folderID, parent)
		return lifecycleActionResult{}, moveErr
	})
}

func (cmd *FolderCopyCmd) Run(r *runtimeState) error {
	parent, err := pageDestination(cmd.Parent)
	if err != nil {
		return err
	}
	return runFolderLifecycleBatch(r, cmd.References, func(c *client, folderID string) (lifecycleActionResult, error) {
		copied, copyErr := c.copyFolder(folderID, parent)
		if copyErr != nil {
			return lifecycleActionResult{SourceID: folderID}, copyErr
		}
		return lifecycleActionResult{
			ID:                     copied.ID,
			SourceID:               folderID,
			SkippedRestrictedItems: copied.SkippedRestrictedItems,
		}, nil
	})
}

func (cmd *FolderDeleteCmd) Run(r *runtimeState) error {
	if err := confirmLifecycleAction(r, cmd.Yes, "Move selected folders to Trash?"); err != nil {
		return err
	}
	return runFolderLifecycleBatch(r, cmd.References, func(c *client, folderID string) (lifecycleActionResult, error) {
		return lifecycleActionResult{}, c.trashFolder(folderID)
	})
}

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
