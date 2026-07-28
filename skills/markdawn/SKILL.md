---
name: markdawn
description: Reads, creates, and safely edits Markdown pages in Markdawn through the official CLI. Use when the user asks to inspect, organize, create, revise, or add content to their Markdawn workspace.
compatibility: Requires the markdawn CLI and a named Markdawn API token with appropriate page scopes.
---

# Markdawn

Use the official `markdawn` CLI. Do not access raw Yjs data or browser-only routes.

## Setup

If `markdawn whoami --json` reports that the client is not logged in, ask the user to create a named API token in Markdawn settings and run:

```bash
markdawn login --url https://their-markdawn-host.example
```

Never print, log, or commit the token. `MARKDAWN_TOKEN` and `MARKDAWN_URL` may be used in ephemeral or CI environments.

## Discover pages

Use JSON for reliable automation:

```bash
markdawn --json page list
markdawn --json folder list
markdawn --json page view "Page title"
```

Page IDs are canonical. A title is only a convenience for interactive lookup. If a title is ambiguous, choose from the returned candidates and retry with the page ID; never guess.

## Create pages

```bash
markdawn --json page create --title "Research notes" --content-file /tmp/initial.md
markdawn --json page create --parent FOLDER_ID --title "Research notes" --content-file /tmp/initial.md
```

Omitting `--title` creates an `Untitled` page. Frontmatter stores page properties, tags, and icon. The page title is separate metadata and is not a generated H1.

## Edit safely

Always read immediately before editing:

```bash
markdawn --json page view PAGE_ID
```

Use exact edit mode for targeted changes. For short edits, pass the exact unique passage and replacement directly:

```bash
markdawn --json page edit exact PAGE_ID \
  --old-text "Current sentence." \
  --new-text "Revised sentence."
```

For multiline Markdown, use temporary files:

```bash
markdawn --json page edit exact PAGE_ID \
  --old-file /tmp/markdawn-old.txt \
  --new-file /tmp/markdawn-new.txt
```

Provide exactly one old source (`--old-text` or `--old-file`) and one new source (`--new-text` or `--new-file`). The old passage must occur exactly once. Include enough surrounding text to make repeated wording unique.

Exact replacement covers all normal edits:

- Insert: keep the anchor in both files and add text around it in the new file.
- Replace: change the matched passage.
- Delete: use `--new-text ""` or make the new file empty.

Do not use occurrence numbers, fuzzy matching, or broad replace-all behavior. To initialize a blank page, use `--expect-empty` with a replacement source; it fails if the page is no longer empty. Markdawn normalizes CRLF to LF but otherwise matches exactly.

If a result is `conflict`, reread the page, reason about the current content, and prepare a new exact replacement. Never retry stale text blindly. Unrelated human edits do not prevent a still-valid exact replacement.

For deliberate whole-page editing by a human, use editor mode:

```bash
markdawn page edit PAGE_ID
```

This opens `$MARKDAWN_EDITOR`, `$VISUAL`, or `$EDITOR` and uploads the complete Markdown only if the page-wide revision still matches. It is appropriate for a human deliberately revising an entire page.

`page edit exact` is the preferred automation path: it applies an exact, uniquely matched passage replacement and leaves unrelated concurrent changes intact. `page edit PAGE_ID` opens the configured editor for a deliberate whole-document rewrite.

## Update page metadata

Use page metadata commands rather than editing Markdown to change a title or icon:

```bash
markdawn --json page update PAGE_ID --title "New title"
markdawn --json page update PAGE_ID --icon "📄"
markdawn --json page update PAGE_ID --clear-icon
```

`page update` changes only page title and icon. `title:` in Markdown frontmatter is ordinary frontmatter and does not rename a page. An `icon:` frontmatter change is also valid when the icon is being changed together with page content or properties.
