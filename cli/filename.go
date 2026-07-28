package main

import (
	"fmt"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

const maxSafeFilenameBytes = 240

var (
	numberedFilename = regexp.MustCompile(`^(.*) \(([2-9][0-9]*)\)$`)
	reservedFilename = regexp.MustCompile(`(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])$`)
)

func readableFilename(value, fallback string) string {
	value = norm.NFC.String(value)
	var result strings.Builder
	previousSpace := false
	for _, character := range value {
		if unicode.IsControl(character) || strings.ContainsRune(`<>:"/\|?*`, character) {
			result.WriteRune('-')
			previousSpace = false
			continue
		}
		if unicode.IsSpace(character) {
			if !previousSpace {
				result.WriteRune(' ')
				previousSpace = true
			}
			continue
		}
		result.WriteRune(character)
		previousSpace = false
	}
	candidate := strings.TrimRight(strings.TrimSpace(result.String()), ". ")
	if candidate == "" {
		candidate = fallback
	}
	period := strings.IndexByte(candidate, '.')
	stem := candidate
	if period >= 0 {
		stem = candidate[:period]
	}
	if reservedFilename.MatchString(stem) {
		candidate = stem + "_" + candidate[len(stem):]
	}
	return candidate
}

func truncateUTF8(value string, maxBytes int) string {
	if maxBytes < 1 {
		return ""
	}
	bytes := 0
	end := 0
	for index, character := range value {
		characterBytes := utf8.RuneLen(character)
		if characterBytes < 0 || bytes+characterBytes > maxBytes {
			break
		}
		bytes += characterBytes
		end = index + characterBytes
	}
	return strings.TrimRight(value[:end], ". ")
}

func filenameWithSuffix(root, suffix, extension string) string {
	available := maxSafeFilenameBytes - len(suffix) - len(extension)
	truncated := truncateUTF8(root, available)
	if truncated == "" {
		truncated = "Untitled"
	}
	return truncated + suffix + extension
}

func allocateFilename(value, extension string, used map[string]struct{}, fallback string) string {
	base := readableFilename(value, fallback)
	root := base
	sequence := 1
	if match := numberedFilename.FindStringSubmatch(base); len(match) == 3 {
		root = match[1]
		_, _ = fmt.Sscanf(match[2], "%d", &sequence)
	}
	candidate := filenameWithSuffix(base, "", extension)
	for {
		key := strings.ToLower(candidate)
		if _, exists := used[key]; !exists {
			used[key] = struct{}{}
			return candidate
		}
		if sequence < 2 {
			sequence = 2
		} else {
			sequence++
		}
		candidate = filenameWithSuffix(root, fmt.Sprintf(" (%d)", sequence), extension)
	}
}
