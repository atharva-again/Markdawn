package main

import (
	"context"
	"fmt"
	"sort"
)

type TrashListCmd struct{}

type TrashRestoreCmd struct {
	EntityType string   `arg:"" enum:"page,folder" name:"type" help:"Type of trashed item."`
	References []string `arg:"" required:"" name:"items" help:"Item IDs or exact titles."`
}

type TrashDeleteCmd struct {
	EntityType string   `arg:"" enum:"page,folder" name:"type" help:"Type of trashed item."`
	References []string `arg:"" required:"" name:"items" help:"Item IDs or exact titles."`
	Yes        bool     `short:"y" help:"Skip the permanent-deletion confirmation."`
}

type TrashEmptyCmd struct {
	Yes bool `short:"y" help:"Skip the permanent-deletion confirmation."`
}

func (cmd *TrashListCmd) Run(r *runtimeState) error {
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
		pages, listErr := requestClient.listTrashedPages()
		pagesDone <- pageResult{pages: pages, err: listErr}
	}()
	go func() {
		folders, listErr := requestClient.listTrashedFolders()
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
	items := make([]trashItem, 0, len(pages)+len(folders))
	for _, item := range pages {
		items = append(items, trashItem{ID: item.ID, Type: "page", Title: item.Title, Icon: item.Icon, DeletedAt: item.DeletedAt})
	}
	for _, item := range folders {
		items = append(items, trashItem{ID: item.ID, Type: "folder", Title: item.Name, Icon: item.Icon, DeletedAt: item.DeletedAt})
	}
	sort.Slice(items, func(i, j int) bool {
		left := ""
		if items[i].DeletedAt != nil {
			left = *items[i].DeletedAt
		}
		right := ""
		if items[j].DeletedAt != nil {
			right = *items[j].DeletedAt
		}
		return left > right
	})
	if r.cli.JSON {
		return r.printJSON(items)
	}
	for _, item := range items {
		deletedAt := ""
		if item.DeletedAt != nil {
			deletedAt = *item.DeletedAt
		}
		if _, err := fmt.Fprintf(r.stdout, "%s\t%s\t%s\t%s\n", terminalText(item.ID), terminalText(item.Type), terminalText(item.Title), terminalText(deletedAt)); err != nil {
			return err
		}
	}
	return nil
}

func (cmd *TrashRestoreCmd) Run(r *runtimeState) error {
	return runTrashLifecycleBatch(r, cmd.EntityType, cmd.References, func(c *client, entityType, id string) error {
		return c.restoreTrashItem(entityType, id)
	})
}

func (cmd *TrashDeleteCmd) Run(r *runtimeState) error {
	if err := confirmLifecycleAction(r, cmd.Yes, "Permanently delete selected trashed items?"); err != nil {
		return err
	}
	return runTrashLifecycleBatch(r, cmd.EntityType, cmd.References, func(c *client, entityType, id string) error {
		return c.deleteTrashItem(entityType, id)
	})
}

func (cmd *TrashEmptyCmd) Run(r *runtimeState) error {
	if err := confirmLifecycleAction(r, cmd.Yes, "Permanently delete every item in Trash?"); err != nil {
		return err
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	if err := c.emptyTrash(); err != nil {
		return uncertainLifecycleMutationOutcome(err)
	}
	if r.cli.JSON {
		return r.printJSON(map[string]bool{"emptied": true})
	}
	_, err = fmt.Fprintln(r.stdout, "Trash emptied.")
	return err
}

func runTrashLifecycleBatch(
	r *runtimeState,
	entityType string,
	references []string,
	action func(*client, string, string) error,
) error {
	c, err := r.client()
	if err != nil {
		return err
	}
	if entityType == "page" {
		pages, listErr := c.listTrashedPages()
		if listErr != nil {
			return listErr
		}
		result, selected := resolveLifecycleBatch(references, func(reference string) (page, error) {
			return r.resolveTrashedPageFromSnapshot(reference, pages)
		}, func(item page) string {
			return item.ID
		})
		return runResolvedLifecycleBatch(r, c, result, selected, func(c *client, item page, id string) (lifecycleActionResult, error) {
			return lifecycleActionResult{}, action(c, entityType, id)
		})
	}

	folders, listErr := c.listTrashedFolders()
	if listErr != nil {
		return listErr
	}
	result, selected := resolveLifecycleBatch(references, func(reference string) (folder, error) {
		return r.resolveTrashedFolderFromSnapshot(reference, folders)
	}, func(item folder) string {
		return item.ID
	})
	return runResolvedLifecycleBatch(r, c, result, selected, func(c *client, item folder, id string) (lifecycleActionResult, error) {
		return lifecycleActionResult{}, action(c, entityType, id)
	})
}
