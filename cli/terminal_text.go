package main

import (
	"strconv"
	"strings"
	"unicode"
)

// terminalText makes untrusted metadata safe for human-readable terminal
// output while keeping printable Unicode unchanged. JSON and raw document
// output intentionally bypass this function.
func terminalText(value string) string {
	var escaped strings.Builder
	for _, char := range value {
		if !unicode.IsControl(char) {
			escaped.WriteRune(char)
			continue
		}
		quoted := strconv.QuoteRune(char)
		escaped.WriteString(quoted[1 : len(quoted)-1])
	}
	return escaped.String()
}

func countLabel(count int64, singular, plural string) string {
	noun := plural
	if count == 1 {
		noun = singular
	}
	return strconv.FormatInt(count, 10) + " " + noun
}
