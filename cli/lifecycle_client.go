package main

import (
	"fmt"
	"net/http"
	"net/url"
)

type trashItem struct {
	ID        string  `json:"id"`
	Type      string  `json:"type"`
	Title     string  `json:"title"`
	Icon      *string `json:"icon"`
	DeletedAt *string `json:"deletedAt"`
}

type folderCopyResult struct {
	folder
	SkippedRestrictedItems bool `json:"skippedRestrictedItems"`
}

func (c *client) listTrashedPages() ([]page, error) {
	response, err := c.request(http.MethodGet, "/trash/pages", nil, nil)
	if err != nil {
		return nil, err
	}
	var pages []page
	return pages, decodeJSON(response, &pages)
}

func (c *client) listTrashedFolders() ([]folder, error) {
	response, err := c.request(http.MethodGet, "/trash/folders", nil, nil)
	if err != nil {
		return nil, err
	}
	var folders []folder
	return folders, decodeJSON(response, &folders)
}

func lifecycleParentBody(parentID *string) ([]byte, error) {
	return marshalBody(map[string]*string{"parentId": parentID})
}

func (c *client) copyPage(id string, parentID *string) (page, error) {
	body, err := lifecycleParentBody(parentID)
	if err != nil {
		return page{}, err
	}
	response, err := c.request(
		http.MethodPost,
		"/pages/"+url.PathEscape(id)+"/copy",
		body,
		map[string]string{"Content-Type": "application/json"},
	)
	if err != nil {
		return page{}, err
	}
	var copied page
	return copied, decodeJSON(response, &copied)
}

func (c *client) copyFolder(id string, parentID *string) (folderCopyResult, error) {
	body, err := lifecycleParentBody(parentID)
	if err != nil {
		return folderCopyResult{}, err
	}
	response, err := c.request(
		http.MethodPost,
		"/folders/"+url.PathEscape(id)+"/copy",
		body,
		map[string]string{"Content-Type": "application/json"},
	)
	if err != nil {
		return folderCopyResult{}, err
	}
	var copied folderCopyResult
	return copied, decodeJSON(response, &copied)
}

func (c *client) movePage(id string, parentID *string) (page, error) {
	body, err := lifecycleParentBody(parentID)
	if err != nil {
		return page{}, err
	}
	response, err := c.request(
		http.MethodPatch,
		"/pages/"+url.PathEscape(id)+"/move",
		body,
		map[string]string{"Content-Type": "application/json"},
	)
	if err != nil {
		return page{}, err
	}
	var moved page
	return moved, decodeJSON(response, &moved)
}

func (c *client) trashPage(id string) error {
	response, err := c.request(http.MethodDelete, "/pages/"+url.PathEscape(id)+"/trash", nil, nil)
	if err != nil {
		return err
	}
	return discardAndCloseResponse(response)
}

func (c *client) trashFolder(id string) error {
	response, err := c.request(http.MethodDelete, "/folders/"+url.PathEscape(id)+"/trash?force=true", nil, nil)
	if err != nil {
		return err
	}
	return discardAndCloseResponse(response)
}

func (c *client) restoreTrashItem(entityType, id string) error {
	response, err := c.request(
		http.MethodPatch,
		fmt.Sprintf("/%ss/%s/restore", entityType, url.PathEscape(id)),
		nil,
		nil,
	)
	if err != nil {
		return err
	}
	return discardAndCloseResponse(response)
}

func (c *client) deleteTrashItem(entityType, id string) error {
	response, err := c.request(
		http.MethodDelete,
		fmt.Sprintf("/%ss/%s/permanent", entityType, url.PathEscape(id)),
		nil,
		nil,
	)
	if err != nil {
		return err
	}
	return discardAndCloseResponse(response)
}

func (c *client) emptyTrash() error {
	response, err := c.request(http.MethodDelete, "/trash/empty", nil, nil)
	if err != nil {
		return err
	}
	return discardAndCloseResponse(response)
}
