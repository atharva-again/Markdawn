package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
)

const maxContentInputBytes = 16 << 20

func readContentFile(path string, stdin io.Reader) ([]byte, error) {
	if path == "-" {
		return readBoundedContent(stdin)
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	defer file.Close()
	data, err := readBoundedContent(file)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	return data, nil
}

func readBoundedContent(reader io.Reader) ([]byte, error) {
	content, err := io.ReadAll(io.LimitReader(reader, maxContentInputBytes+1))
	if err != nil {
		return nil, err
	}
	if len(content) > maxContentInputBytes {
		return nil, &cliError{
			Code:       "payload_too_large",
			Message:    "content exceeds the 16 MiB limit",
			StatusCode: http.StatusRequestEntityTooLarge,
		}
	}
	return content, nil
}

func replacementInput(text *string, file string, stdin io.Reader, label string) ([]byte, error) {
	if (text == nil && file == "") || (text != nil && file != "") {
		return nil, usageError("provide exactly one of --%s-text or --%s-file", label, label)
	}
	if text != nil {
		return []byte(*text), nil
	}
	return readContentFile(file, stdin)
}
