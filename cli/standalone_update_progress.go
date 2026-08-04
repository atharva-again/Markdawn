package main

import (
	"fmt"
	"io"

	"github.com/charmbracelet/lipgloss"
)

var progressMarkerStyle = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("12"))

type updateProgressReporter interface {
	phase(string)
	download(string, int64, int64)
	finish()
}

type noOpUpdateProgress struct{}

func (noOpUpdateProgress) phase(string)                  {}
func (noOpUpdateProgress) download(string, int64, int64) {}
func (noOpUpdateProgress) finish()                       {}

type updateProgressRenderer struct {
	writer      io.Writer
	marker      string
	active      bool
	lastPercent int
}

func newUpdateProgress(r *runtimeState) updateProgressReporter {
	if r.cli.JSON || !r.stderrTTY || r.cli.Plain {
		return noOpUpdateProgress{}
	}
	marker := "==>"
	if !noColor() {
		marker = progressMarkerStyle.Render(marker)
	}
	return &updateProgressRenderer{
		writer: r.stderr,
		marker: marker,
	}
}

func (renderer *updateProgressRenderer) phase(message string) {
	if renderer.active {
		_, _ = fmt.Fprint(renderer.writer, "\r\033[2K")
		renderer.active = false
	}
	_, _ = fmt.Fprintf(renderer.writer, "%s %s\n", renderer.marker, message)
}

func (renderer *updateProgressRenderer) download(label string, received, total int64) {
	if total <= 0 {
		return
	}
	percent := int(received * 100 / total)
	if percent > 100 {
		percent = 100
	}
	if renderer.active && renderer.lastPercent == percent {
		return
	}
	_, err := fmt.Fprintf(
		renderer.writer,
		"\r\033[2K%s Downloading %s [%3d%%]",
		renderer.marker,
		label,
		percent,
	)
	renderer.active = err == nil
	if renderer.active {
		renderer.lastPercent = percent
	}
}

func (renderer *updateProgressRenderer) finish() {
	if !renderer.active {
		return
	}
	renderer.active = false
	_, _ = fmt.Fprintln(renderer.writer)
}
