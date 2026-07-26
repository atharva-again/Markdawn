# Markdawn CLI

The official terminal client for Markdawn's versioned API. It is designed for both people and automation: terminal output is readable by default, redirected output is plain and untruncated, and `--json` provides structured output for scripts and agents.

## Install

From source:

```sh
go install github.com/markdawn/markdawn/cli@latest
```

Release archives are built for Linux, macOS, and Windows on amd64 and arm64. Verify an installation with:

```sh
markdawn --version
```

## Authenticate

Create a named token in **Markdawn Settings → API tokens**, then run:

```sh
markdawn login --url https://markdawn.example.com
```

The token is validated before it is saved. The config directory is created with mode `0700` and the config file with mode `0600`.

For CI and short-lived agent sessions, avoid writing a config file:

```sh
export MARKDAWN_URL=https://markdawn.example.com
export MARKDAWN_TOKEN=mdn_...
markdawn --json page list
```

Environment variables override saved configuration. Do not pass tokens as command-line arguments, where they may be exposed in process listings and shell history.

## Commands

```text
markdawn login [--url URL]
markdawn logout
markdawn whoami
markdawn help [command...]

markdawn page list [--parent FOLDER_ID] [--limit N]
markdawn page view <page-id-or-title> [--raw]
markdawn page create [--title TITLE] [--parent FOLDER_ID] [--file FILE]
markdawn page edit <page-id-or-title>
markdawn page update <page-id-or-title> [--title TITLE] [--icon ICON | --clear-icon]
markdawn page replace <page-id-or-title> {--old-text OLD | --old-file OLD} {--new-text NEW | --new-file NEW}

markdawn folder list
markdawn completion {bash|zsh|fish}
```

`page show` is retained as an alias for `page view`, and `me` is an alias for `whoami`.

### Create from a file or stdin

```sh
markdawn page create --title "Project plan" --file plan.md
printf '# Notes\n\nCreated in CI.\n' | markdawn page create --title Notes --file -
```

The title is page metadata. Initial Markdown is the authored body; the CLI does not synthesize a title heading.

### Edit safely

```sh
export EDITOR="code --wait"
markdawn page edit "Project plan"
```

The CLI downloads the current Markdown and ETag, opens `MARKDAWN_EDITOR`, `VISUAL`, or `EDITOR`, then performs an `If-Match` guarded upload. If the page changed while the editor was open, the upload fails instead of overwriting newer work.

### Apply an exact replacement

For a short agent or shell edit, pass strings directly:

```sh
markdawn page replace "Project plan" \
  --old-text "Draft" \
  --new-text "Approved"
```

For multiline Markdown, use files or stdin:

```sh
markdawn page replace "Project plan" \
  --old-file current-passage.md \
  --new-file revised-passage.md
```

Provide exactly one old source (`--old-text` or `--old-file`) and one new source (`--new-text` or `--new-file`). The old passage must occur exactly once after CRLF-to-LF normalization. The CLI generates an edit ID and idempotency key unless explicitly supplied. If a generated-key request times out with an uncertain outcome, the error reports that key; retry with `--idempotency-key KEY` to retrieve the committed result without applying the edit again. Use `--new-text ""` or an empty replacement file for deletion.

### Update metadata

```sh
markdawn page update "Project plan" --title "Project Plan"
markdawn page update "Project Plan" --icon "📋"
markdawn page update "Project Plan" --clear-icon
```

`page update` changes page metadata only. Its title is independent of Markdown frontmatter; `title:` frontmatter is preserved as authored frontmatter and does not rename the page. An icon may be changed with `--icon` or by editing the `icon:` frontmatter field as part of a Markdown edit.

## Page references

Commands accept a stable page UUID or an exact, case-insensitive title. Title resolution and disambiguating folder paths are computed by the permission-aware server endpoint rather than by scanning the workspace locally. If several pages have the same title, an interactive terminal presents a Charm selection prompt including folder paths and IDs. In non-interactive mode the command fails and returns all candidates. Prefer IDs in scripts.

Use `--no-input` to prohibit prompts explicitly.

## Output

- Interactive terminals use Lip Gloss tables and Glamour Markdown rendering.
- Piped list output uses tab-separated, untruncated records with no header or ANSI styling.
- Piped `page view` output is raw Markdown.
- `--plain` disables rich output explicitly.
- `--json` writes stable JSON to stdout, including structured errors.
- `NO_COLOR` disables color.

Examples:

```sh
markdawn page list
markdawn page list --json | jq '.[].id'
markdawn page view PAGE_ID --raw > page.md
markdawn folder list --json
```

## Shell completion

```sh
# bash
source <(markdawn completion bash)

# zsh
source <(markdawn completion zsh)

# fish
markdawn completion fish | source
```

## Environment

| Variable | Purpose |
| --- | --- |
| `MARKDAWN_TOKEN` | Bearer token; overrides the saved token. |
| `MARKDAWN_URL` | Server URL; overrides the saved URL. |
| `MARKDAWN_EDITOR` | Preferred command for `page edit`. |
| `VISUAL`, `EDITOR` | Editor fallbacks, in that order. |
| `MARKDAWN_CONFIG_DIR` | Override the config directory. |
| `NO_COLOR` | Disable color output. |

## Exit statuses

| Status | Meaning |
| --- | --- |
| `0` | Command completed successfully. |
| `1` | API, network, or command failure. |
| `2` | Invalid command arguments. |
| `4` | Authentication or authorization failure. |
| `5` | Revision or exact-edit conflict. |
| `70` | Internal startup failure. |
| `130` | Interrupted by the user. |

Run `markdawn <command> --help` for complete command-specific flags.
`markdawn help <command...>` is an equivalent command form, for example `markdawn help page update`.

## Maintainer releases

Push a signed `cli/vX.Y.Z` tag. The release workflow runs race-enabled tests, cross-compiles six platform/architecture combinations, creates checksums, publishes build-provenance attestations, and attaches the archives to a GitHub release.
