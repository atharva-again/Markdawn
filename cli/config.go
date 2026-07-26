package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

const defaultBaseURL = "http://localhost:3001"

type config struct {
	BaseURL string `json:"baseUrl"`
	Token   string `json:"token"`
}

func configPath() (string, error) {
	if dir := os.Getenv("MARKDAWN_CONFIG_DIR"); dir != "" {
		return filepath.Join(dir, "config.json"), nil
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "markdawn", "config.json"), nil
}

func loadConfig() (config, error) {
	result := config{BaseURL: defaultBaseURL}
	path, err := configPath()
	if err != nil {
		return result, err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return result, nil
	}
	if err != nil {
		return result, err
	}
	if !utf8.Valid(data) {
		return result, fmt.Errorf("read config: invalid UTF-8")
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return result, fmt.Errorf("read config: %w", err)
	}
	if result.BaseURL == "" {
		result.BaseURL = defaultBaseURL
	}
	result.BaseURL = strings.TrimRight(result.BaseURL, "/")
	return result, nil
}

func saveConfig(value config) error {
	path, err := configPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	// WriteFile preserves the mode of an existing file. Restrict it before
	// writing so a previously permissive config cannot expose the new token
	// during the write or after a crash before a later chmod.
	if err := os.Chmod(path, 0o600); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.WriteFile(path, append(data, '\n'), 0o600); err != nil {
		return err
	}
	return nil
}

func removeConfig() error {
	path, err := configPath()
	if err != nil {
		return err
	}
	err = os.Remove(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
