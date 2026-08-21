# Markdawn CLI

The official terminal client for Markdawn. The browser and CLI use the same content layer: a page
written in the browser and a page read, edited, or linked by an agent are the same page. There is
no separate agent mode, adapter, or second data store.

Terminal output is readable by default, redirected output is plain and untruncated, and `--json`
provides structured output for scripts and agents.

## Install

Linux and macOS:

```sh
curl -fsSL https://markdawn.space/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://markdawn.space/install.ps1 | iex
```

The standalone installer downloads the matching release archive, verifies its SHA-256
checksum, and installs Markdawn to `~/.markdawn/bin` on Linux/macOS or
`%LOCALAPPDATA%\Markdawn\bin` on Windows. It automatically adds a clearly marked PATH block to
your shell or PowerShell profile. To leave PATH unchanged, opt out explicitly:

```sh
curl -fsSL https://markdawn.space/install.sh | MARKDAWN_MODIFY_PATH=0 sh
```

In PowerShell, run `$env:MARKDAWN_MODIFY_PATH = 0` before the installer command.

PATH changes apply to future terminal sessions. Open a new terminal before invoking `markdawn` by
name.

To install the optional agent skill in the same non-interactive bootstrap, choose a scope with
`MARKDAWN_INSTALL_SKILL`. This requires Node.js and `npx`; an explicit skill request fails loudly
after the CLI is installed if `npx skills` cannot finish.

```sh
# Install the CLI and a global agent skill.
curl -fsSL https://markdawn.space/install.sh | MARKDAWN_INSTALL_SKILL=global sh

# Install the skill in the current project instead.
curl -fsSL https://markdawn.space/install.sh | MARKDAWN_INSTALL_SKILL=project sh
```

In PowerShell:

```powershell
$env:MARKDAWN_INSTALL_SKILL = 'global'; irm https://markdawn.space/install.ps1 | iex
```

To install a specific release, set `MARKDAWN_VERSION`, for example:

```sh
curl -fsSL https://markdawn.space/install.sh | MARKDAWN_VERSION=v1.2.3 sh
```

Installer configuration:

| Variable | Purpose |
| --- | --- |
| `MARKDAWN_VERSION` | Install a semantic version such as `v1.2.3`; the default is the latest stable release. |
| `MARKDAWN_INSTALL_DIR` | Override the platform-default binary directory. |
| `MARKDAWN_INSTALL_STATE_DIR` | Override the directory containing the standalone install receipt. |
| `MARKDAWN_MODIFY_PATH` | Set to `0` to leave PATH unchanged; the default is `1`, which adds a marked PATH block to the detected shell profile. |
| `MARKDAWN_INSTALL_SKILL` | Set to `global` or `project` to invoke `npx skills` after a successful CLI installation; leave unset or set to `0` to skip it. |
| `MARKDAWN_PROFILE_PATH` | Override the PowerShell profile modified on Windows. |
| `MARKDAWN_HTTP_TIMEOUT_SECONDS` | Set a positive timeout for each installer download. |

Go users can also install from source:

```sh
go install github.com/atharva-again/Markdawn/cli@latest
```

Release archives are built for Linux, macOS, and Windows on amd64 and arm64. Verify an installation with:

```sh
markdawn --version
```

Release archives, checksum manifests, and installer scripts carry GitHub build-provenance
attestations. To independently verify a downloaded file before using it:

```sh
gh attestation verify markdawn_1.2.3_linux_amd64.tar.gz --repo atharva-again/Markdawn
```

## Agent skills

Markdawn ships an [Agent Skills](https://agentskills.io) compatible `markdawn` skill. If Node.js
is available, install or update it with:

```sh
markdawn skill install
markdawn skill install --global
markdawn skill update
```

The skill documents the safe workflow for discovery and targeted edits. It is optional; the CLI
has no Node.js dependency.

## Authenticate

Create a named token in **Markdawn Settings → API tokens**, then run:

```sh
markdawn login
```

`markdawn login` defaults to `https://app.markdawn.space`. Pass `--url URL` or set `MARKDAWN_URL`
for a self-hosted server.

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
# Authentication
markdawn login [--url URL]
markdawn logout
markdawn whoami

# Page
markdawn page copy <page-id-or-title>... [--parent FOLDER_ID]
markdawn page create [--title TITLE] [--parent FOLDER_ID] [--icon ICON] [--content-file FILE]
markdawn page delete <page-id-or-title>... [--yes]
markdawn page edit <page-id-or-title> [--editor COMMAND]
markdawn page edit append <page-id-or-title> {--content-text CONTENT | --content-file FILE}
markdawn page edit exact <page-id-or-title> {--old-text OLD | --old-file OLD} {--new-text NEW | --new-file NEW}
markdawn page edit exact <page-id-or-title> --expect-empty {--new-text NEW | --new-file NEW}
markdawn page edit interactive <page-id-or-title> [--editor COMMAND]
markdawn page edit prepend <page-id-or-title> {--content-text CONTENT | --content-file CONTENT}
markdawn page edit replace <page-id-or-title> {--content-text CONTENT | --content-file CONTENT}
markdawn page list [--parent FOLDER_ID] [--limit N]
markdawn page move <page-id-or-title>... [--parent FOLDER_ID]
markdawn page update <page-id-or-title> [--title TITLE] [--icon ICON | --clear-icon]
markdawn page view <page-id-or-title> [--raw]

# Folder
markdawn folder copy <folder-id-or-name>... [--parent FOLDER_ID]
markdawn folder create [--name NAME] [--parent FOLDER_ID]
markdawn folder delete <folder-id-or-name>... [--yes]
markdawn folder list
markdawn folder move <folder-id-or-name>... [--parent FOLDER_ID]
markdawn folder update <folder-id-or-name> --name NAME

# Trash
markdawn trash delete {page|folder} <id-or-title>... [--yes]
markdawn trash empty [--yes]
markdawn trash list
markdawn trash restore {page|folder} <id-or-title>...

# Import and Export
markdawn export all --output FILE [--force]
markdawn export page <page-id-or-title> [--output FILE] [--force]
markdawn import folder DIRECTORY [--yes]
markdawn import page FILE.md

# Skill
markdawn skill install [--global] [--copy] [--yes]
markdawn skill update [--global | --project] [--yes]

# Tooling
markdawn completion {bash|zsh|fish}
markdawn doctor
markdawn uninstall [--purge] [--dry-run] [--yes]
markdawn update [VERSION]
```

## Work safely

Use stable page IDs in scripts. Exact titles are a convenience for interactive use; ambiguous
titles prompt for a choice, while `--no-input` fails rather than guessing.

Read before a targeted edit and use `exact` whenever possible:

```sh
markdawn page view PAGE_ID --raw
markdawn page edit exact PAGE_ID --old-text "Draft" --new-text "Approved"
```

Use `replace` for a deliberate full-document rewrite; use `append` or `prepend` for a document
boundary change. `page edit` opens the configured editor and protects the upload with the current
revision. `page update` changes title or icon only.

Lifecycle and content mutations are never automatically retried. If an operation reports
`outcome_uncertain`, inspect the affected page, folder, or Trash before retrying; a copy may have
already succeeded.

## Output

`--json` writes structured JSON with stable field names and status values, including structured
errors. Human-readable `message` text may change; scripts should use error codes, statuses, and
structured fields instead of matching message text. `--plain` disables rich terminal output;
`NO_COLOR` also disables color. Piped `page view` output is raw markdown.

## Tooling

```sh
# bash
source <(markdawn completion bash)

# zsh
source <(markdawn completion zsh)

# fish
markdawn completion fish | source
```

`markdawn doctor` reports the config location, resolved server, authentication status, token
access, standalone-install health, and optional skills-tool availability without printing the
token. JSON output includes structured receipt paths, binary paths, errors, required commands, and
install commands when applicable.

`markdawn update` downloads a checksum-verified standalone release. Go-installed binaries should
be updated with `go install github.com/atharva-again/Markdawn/cli@latest` instead. JSON output uses
`target` for the requested channel or pinned version; `version` is included only for pinned updates.

```sh
markdawn update
markdawn uninstall --dry-run
markdawn uninstall --yes
markdawn uninstall --purge --yes
```

`uninstall` removes the standalone binary and receipt while preserving local configuration unless
`--purge` is supplied. `--purge` removes only local configuration and credentials; remote workspace
data and unrelated skills are preserved. Use `--yes` non-interactively. If an install, update, or
uninstall is interrupted, rerun the command.

## Environment

| Variable | Purpose |
| --- | --- |
| `MARKDAWN_TOKEN` | Bearer token; overrides the saved token. |
| `MARKDAWN_URL` | Server URL; overrides the saved URL. |
| `MARKDAWN_EDITOR` | Preferred command for editor-mode `page edit`. |
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
