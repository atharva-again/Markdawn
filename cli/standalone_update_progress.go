package main

import (
	"fmt"
	"io"
	"time"

	"github.com/charmbracelet/lipgloss"
)

var progressMarkerStyle = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("12"))

type updateProgressReporter interface {
	phase(string)
	download(string, int64, int64)
	finishDownload()
}

type noOpUpdateProgress struct{}

func (noOpUpdateProgress) phase(string)                  {}
func (noOpUpdateProgress) download(string, int64, int64) {}
func (noOpUpdateProgress) finishDownload()               {}

type downloadSnapshot struct {
	label    string
	received int64
	total    int64
}

type updateProgressRenderer struct {
	writer             io.Writer
	marker             string
	lastDownloadUpdate time.Time
	pendingDownload    *downloadSnapshot
	downloadLineActive bool
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
	renderer.finishDownload()
	_, _ = fmt.Fprintf(renderer.writer, "%s %s\n", renderer.marker, message)
}

func (renderer *updateProgressRenderer) download(label string, received, total int64) {
	renderer.pendingDownload = &downloadSnapshot{label: label, received: received, total: total}
	now := time.Now()
	if (total <= 0 || received < total) && !renderer.lastDownloadUpdate.IsZero() && now.Sub(renderer.lastDownloadUpdate) < 100*time.Millisecond {
		return
	}
	renderer.lastDownloadUpdate = now
	renderer.renderPendingDownload()
}

func (renderer *updateProgressRenderer) renderPendingDownload() {
	if renderer.pendingDownload == nil {
		return
	}
	snapshot := *renderer.pendingDownload
	renderer.pendingDownload = nil
	progress := fmt.Sprintf("%d bytes", snapshot.received)
	if snapshot.total > 0 {
		percent := snapshot.received * 100 / snapshot.total
		if percent > 100 {
			percent = 100
		}
		progress = fmt.Sprintf("%d%% (%d/%d bytes)", percent, snapshot.received, snapshot.total)
	}
	line := fmt.Sprintf("%s %s %s", renderer.marker, snapshot.label, progress)
	renderer.downloadLineActive = true
	_, _ = fmt.Fprintf(renderer.writer, "\r\033[2K%s", line)
}

func (renderer *updateProgressRenderer) finishDownload() {
	renderer.renderPendingDownload()
	if !renderer.downloadLineActive {
		return
	}
	_, _ = fmt.Fprintln(renderer.writer)
	renderer.downloadLineActive = false
	renderer.lastDownloadUpdate = time.Time{}
}
