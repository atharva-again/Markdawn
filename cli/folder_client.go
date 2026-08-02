package main

import (
	"net/http"
	"net/url"
)

type folderResolutionItem struct {
	folder
	FolderPath string `json:"folderPath"`
}

type folderResolution struct {
	Data []folderResolutionItem `json:"data"`
}

type createFolderRequest struct {
	Name     *string `json:"name,omitempty"`
	ParentID *string `json:"parentId,omitempty"`
}

type updateFolderRequest struct {
	Name *string `json:"name"`
}

type moveFolderRequest struct {
	ParentID *string `json:"parentId"`
}

func (c *client) getFolder(id string) (folder, error) {
	response, err := c.request(http.MethodGet, "/folders/"+url.PathEscape(id), nil, nil)
	if err != nil {
		return folder{}, err
	}
	var result folder
	return result, decodeJSON(response, &result)
}

func (c *client) resolveFoldersByName(name string) ([]folderResolutionItem, error) {
	response, err := c.request(
		http.MethodGet,
		"/folders/resolve?name="+url.QueryEscape(name),
		nil,
		nil,
	)
	if err != nil {
		return nil, err
	}
	var resolved folderResolution
	if err := decodeJSON(response, &resolved); err != nil {
		return nil, err
	}
	return resolved.Data, nil
}

func (c *client) createFolder(request createFolderRequest) (folder, error) {
	body, err := marshalBody(request)
	if err != nil {
		return folder{}, err
	}
	response, err := c.request(
		http.MethodPost,
		"/folders",
		body,
		map[string]string{"Content-Type": "application/json"},
	)
	if err != nil {
		return folder{}, err
	}
	var created folder
	return created, decodeJSON(response, &created)
}

func (c *client) updateFolder(id string, request updateFolderRequest) (folder, error) {
	body, err := marshalBody(request)
	if err != nil {
		return folder{}, err
	}
	response, err := c.request(
		http.MethodPatch,
		"/folders/"+url.PathEscape(id),
		body,
		map[string]string{"Content-Type": "application/json"},
	)
	if err != nil {
		return folder{}, err
	}
	var updated folder
	return updated, decodeJSON(response, &updated)
}

func (c *client) moveFolder(id string, parentID *string) (folder, error) {
	body, err := marshalBody(moveFolderRequest{ParentID: parentID})
	if err != nil {
		return folder{}, err
	}
	response, err := c.request(
		http.MethodPatch,
		"/folders/"+url.PathEscape(id),
		body,
		map[string]string{"Content-Type": "application/json"},
	)
	if err != nil {
		return folder{}, err
	}
	var moved folder
	return moved, decodeJSON(response, &moved)
}
