package main

import (
	"crypto/rand"
	"encoding/base64"
)

func randomRequestID() (string, error) {
	data := make([]byte, 12)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return "cli-" + base64.RawURLEncoding.EncodeToString(data), nil
}
