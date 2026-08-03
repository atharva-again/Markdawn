---
name: markdawn
description: Use this skill when a user asks to use the official CLI to find, read, create, organize, edit, move, copy, delete, restore, import, or export Markdawn pages and folders. Apply it for requests about Markdawn content, workspace organization, or safe agent-driven changes, even when the user does not mention the CLI.
compatibility: Requires the markdawn CLI and a named Markdawn API token with appropriate page scopes.
---

# Markdawn

Markdawn is a knowledge base for humans and their AI agents. The browser and the official
`markdawn` CLI work against the same content layer: changes made by an agent are ordinary
workspace changes, not a separate agent mode or data store.

Use the CLI. Do not access raw Yjs data, the database, or browser-only routes.

## Setup

If `markdawn whoami --json` reports that the client is not logged in, ask the user to create a named API token in Markdawn settings and run:

```bash
markdawn login --url https://their-markdawn-host.example
```

Never print, log, or commit the token. `MARKDAWN_TOKEN` and `MARKDAWN_URL` may be used in ephemeral or CI environments.

## Command groups

Root CLI help organizes commands into singular title-case groups, with commands alphabetized within
each group:

- **Authentication**: `login`, `logout`, and `whoami`.
- **Page**: page discovery, creation, editing, metadata, and lifecycle commands.
- **Folder**: folder discovery and lifecycle commands.
- **Trash**: list, restore, permanent deletion, and emptying Trash.
- **Import and Export**: page and folder imports plus page and workspace exports.
- **Skill**: install and update the Markdawn agent skill.
- **Tooling**: completion, diagnostics, standalone updates, and uninstall.

Use `markdawn help` for the categorized root command list or `markdawn <command> --help` for
command-specific syntax.

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

For multiline markdown, use temporary files:

```bash
markdawn --json page edit exact PAGE_ID \
  --old-file /tmp/markdawn-old.txt \
  --new-file /tmp/markdawn-new.txt
```

Provide exactly one old source (`--old-text` or `--old-file`) and one new source (`--new-text` or `--new-file`). The old passage must occur exactly once. Include enough surrounding text to make repeated wording unique.

Use exact edits for targeted insertions, replacements, and deletions. To insert, keep a unique
anchor in both old and new content and add the new markdown around that anchor. To delete, use
`--new-text ""` or an empty replacement file.

Do not use occurrence numbers, fuzzy matching, or broad replace-all behavior. To initialize a blank page, use `--expect-empty` with a replacement source; it fails if the page is no longer empty. Markdawn normalizes CRLF to LF but otherwise matches exactly.

If a result is `conflict`, reread the page, reason about the current content, and prepare a new exact replacement. Never retry stale text blindly. Unrelated human edits do not prevent a still-valid exact replacement.

For deliberate whole-page editing by a human, use editor mode:

```bash
markdawn page edit PAGE_ID
```

This opens `$MARKDAWN_EDITOR`, `$VISUAL`, or `$EDITOR` and uploads the complete markdown only if the page-wide revision still matches. It is appropriate for a human deliberately revising an entire page.

`page edit exact` is the preferred automation path: it applies an exact, uniquely matched passage replacement and leaves unrelated concurrent changes intact. `page edit PAGE_ID` opens the configured editor for a deliberate whole-document rewrite.

## Whole-page changes

Use one of these commands only when the requested operation is intentionally about the entire
document. Each accepts exactly one of `--content-text` or `--content-file`; `-` reads content from
stdin.

```bash
markdawn --json page edit replace PAGE_ID --content-file /tmp/revised.md
markdawn --json page edit append PAGE_ID --content-text "## Next steps"
markdawn --json page edit prepend PAGE_ID --content-file /tmp/introduction.md
```

- `replace` safely replaces the complete authored markdown. An empty content value clears a page.
- `append` and `prepend` require non-empty content and insert exactly one blank markdown line at
  the boundary.
- `replace` checks the document revision and returns a conflict if the page changed first.
- `append` and `prepend` run against the server's latest document, so unrelated concurrent edits
  can coexist with the requested boundary change.

For a small change inside a page, use `page edit exact`, not `replace`.

## Update page metadata

Use page metadata commands rather than editing markdown to change a title or icon:

```bash
markdawn --json page update PAGE_ID --title "New title"
markdawn --json page update PAGE_ID --icon "📄"
markdawn --json page update PAGE_ID --clear-icon
```

`page update` changes only page title and icon. `title:` in markdown frontmatter is ordinary frontmatter and does not rename a page. An `icon:` frontmatter change is also valid when the icon is being changed together with page content or properties.
