# Markdawn CLI

The official terminal client for Markdawn's versioned API. It is designed for both people and automation: terminal output is readable by default, redirected output is plain and untruncated, and `--json` provides structured output for scripts and agents.

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

PATH changes apply to future terminal sessions. Open a new terminal or source the profile named
by the installer before invoking `markdawn` by name; the installer also prints an absolute-path
`markdawn login` command that works immediately.

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

Markdawn ships an [Agent Skills](https://agentskills.io) compatible `markdawn` skill. It gives an
agent the safe CLI workflow for discovering pages, making targeted edits, and handling conflicts.

If Node.js is available, the optional [Vercel skills CLI](https://github.com/vercel-labs/skills)
installs the skill into the correct paths for installed agents and manages future updates:

```sh
# Current project; npx skills asks which installed agents to target.
markdawn skill install

# All of your projects
markdawn skill install --global

# Update a previously installed skill
markdawn skill update
```

`npx skills` is optional; Markdawn itself has no Node.js dependency. `markdawn skill` delegates
agent-specific installation locations to `npx skills`; use `--copy` when symlinks are unsuitable,
or use `--yes` for a non-interactive npx installation.

For a project skill, commit the skill directory only when every collaborator should receive these
instructions. Prefer a global install for a personal agent setup.

## Authenticate

Create a named token in **Markdawn Settings → API tokens**, then run:

```sh
markdawn login
```

`markdawn login` defaults to `https://markdawn.space`. Pass `--url URL` or set `MARKDAWN_URL`
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
markdawn login [--url URL]
markdawn logout
markdawn whoami
markdawn doctor
markdawn skill install [--global] [--copy] [--yes]
markdawn skill update [--global | --project] [--yes]
markdawn update [VERSION]
markdawn uninstall [--purge] [--remove-path] [--dry-run] [--yes]
markdawn help [command...]

markdawn page list [--parent FOLDER_ID] [--limit N]
markdawn page view <page-id-or-title> [--raw]
markdawn page create [--title TITLE] [--parent FOLDER_ID] [--icon ICON] [--content-file FILE]
markdawn page edit <page-id-or-title> [--editor COMMAND]
markdawn page edit interactive <page-id-or-title> [--editor COMMAND]
markdawn page edit exact <page-id-or-title> {--old-text OLD | --old-file OLD} {--new-text NEW | --new-file NEW}
markdawn page edit exact <page-id-or-title> --expect-empty {--new-text NEW | --new-file NEW}
markdawn page edit replace <page-id-or-title> {--content-text CONTENT | --content-file CONTENT}
markdawn page edit append <page-id-or-title> {--content-text CONTENT | --content-file CONTENT}
markdawn page edit prepend <page-id-or-title> {--content-text CONTENT | --content-file CONTENT}
markdawn page update <page-id-or-title> [--title TITLE] [--icon ICON | --clear-icon]

markdawn folder list
markdawn completion {bash|zsh|fish}
```

### Create from a file or stdin

```sh
markdawn page create --title "Project plan" --content-file plan.md
printf '# Notes\n\nCreated in CI.\n' | markdawn page create --title Notes --content-file -
```

The title is page metadata. Initial Markdown is the authored body; the CLI does not synthesize a title heading.

### Edit in an editor

```sh
markdawn page edit "Project plan"
markdawn page edit "Project plan" --editor "code --wait"
markdawn page edit interactive "Project plan"
```

`page edit` downloads the current Markdown and ETag, opens `MARKDAWN_EDITOR`, `VISUAL`, or `EDITOR`, then performs an `If-Match` guarded upload. `--editor COMMAND` overrides those variables for one invocation. If the page changed while the editor was open, the upload fails instead of overwriting newer work.
`page edit interactive` is the explicit equivalent of `page edit`.

### Apply an exact edit

For a short agent or shell edit, pass strings directly:

```sh
markdawn page edit exact "Project plan" \
  --old-text "Draft" \
  --new-text "Approved"
```

Markdawn does not retry page-content writes automatically. On a network, service, or uncertain
edit failure, inspect the page before deciding whether to issue another edit. Automation using
`exact`, `append`, or `prepend` can supply both `--id` and `--idempotency-key` for
caller-managed idempotency.

For multiline Markdown, use files or stdin:

```sh
markdawn page edit exact "Project plan" \
  --old-file current-passage.md \
  --new-file revised-passage.md
```

Provide exactly one old source (`--old-text` or `--old-file`) and one new source (`--new-text` or `--new-file`). The old passage must occur exactly once after CRLF-to-LF normalization. The CLI generates an edit ID and idempotency key unless explicitly supplied. If a generated-key request times out with an uncertain outcome, the error reports both identifiers for diagnostics; inspect the page before issuing another edit. Do not blindly rerun a whole-page append, prepend, or replace after an uncertain outcome. Use `--new-text ""` or an empty replacement file for deletion.

To initialize a blank page without an ambiguous empty-text match, use `--expect-empty`:

```sh
markdawn page edit exact "Project plan" --expect-empty --new-file initial.md
```

It applies only if the page is still empty; otherwise it returns a conflict.

### Replace, append, or prepend a whole page

Use `replace` for a deliberate full-document rewrite. It accepts exactly one content source and
allows an empty `--content-text ""` or empty file to clear the page:

```sh
markdawn page edit replace "Project plan" --content-file revised-plan.md
```

`append` and `prepend` add non-empty Markdown, separated from the existing document by exactly
one blank Markdown line:

```sh
markdawn page edit append "Project plan" --content-text "## Next steps"
markdawn page edit prepend "Project plan" --content-file introduction.md
```

`replace` reads the document's current revision and only saves when it is still current; it fails
on any concurrent page change rather than overwriting it. `append` and `prepend` are applied by
the server against the latest document, so unrelated concurrent edits do not cause a conflict.
All three normalize supplied CRLF line endings to LF. `replace` otherwise preserves supplied
Markdown. To enforce exactly one blank boundary line on a non-empty page, `append` removes leading
line breaks from its supplied content and `prepend` removes trailing line breaks from its supplied
content; both also remove boundary line breaks from the existing document.

### Update title or icon

```sh
markdawn page update "Project plan" --title "Project Plan"
markdawn page update "Project Plan" --icon "📋"
markdawn page update "Project Plan" --clear-icon
```

`page update` changes page metadata only. Its title is independent of Markdown frontmatter; `title:` frontmatter is preserved as authored frontmatter and does not rename the page. Markdown frontmatter/properties and the body are edited through `page edit`; an `icon:` frontmatter field is persisted as the page icon.

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

## Update and uninstall

`markdawn update` downloads a checksum-verified release archive and replaces the standalone binary.
It only operates on a binary installed by the standalone installer; binaries installed with Go should be updated with `go install
github.com/atharva-again/Markdawn/cli@latest` instead.

```sh
markdawn update
markdawn update v1.2.3
markdawn uninstall --dry-run
markdawn uninstall --yes
markdawn uninstall --purge --yes
```

## Diagnose an installation

`markdawn doctor` reports the CLI version, resolved server, authentication status, standalone
receipt health, and whether the optional `npx skills` tool is available. It validates a configured
token with the server without printing the token.

```sh
markdawn doctor
markdawn --json doctor
```

## Standalone platform support

The standalone installer supports Linux, macOS, and Windows. Linux and macOS use `install.sh`; Windows uses `install.ps1`.

WSL2 is treated as a separate Linux environment: install Markdawn inside WSL with `install.sh` and configure the WSL shell PATH. It does not modify the Windows PATH or share the Windows standalone receipt. Install under the WSL Linux home directory rather than `/mnt/*`; Windows-mounted filesystems have different permission, locking, and atomic-rename behavior. The installer warns when a custom WSL install directory is under `/mnt`.

If an install, update, or uninstall is interrupted, rerun the same command. Installer publication and PATH changes are rolled back when publication fails. Uninstall records completed PATH cleanup before continuing and preserves or restores its receipt while the binary remains. For a Windows deferred update or uninstall failure, the next invocation reports and clears the persisted failure; run the command once more to retry the operation.

Uninstall preserves saved credentials and configuration unless `--purge` is supplied. If the
installer created its marked PATH block, use `--remove-path` to remove it.

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

## Maintainer releases

Releases are **release-last**: the public GitHub release and its `cli/vX.Y.Z` tag are created only after the build, verification, and provenance-attestation steps succeed.

1. Prepare and merge a release PR from `master`, including the user-facing release notes and any required documentation or compatibility changes.
2. In GitHub Actions, run **Release CLI** from `master` and enter `X.Y.Z` (without a leading `v`).
3. A second maintainer approves the `release-gate` environment deployment.
4. The workflow reruns native Linux, macOS, and Windows tests—including transactional installer and uninstall E2E coverage—then cross-compiles six platform/architecture combinations, creates deterministic versioned archives and stable-release aliases, checksums, and build-provenance attestations.
5. Finally, it creates the GitHub release, targeting the selected `master` commit, and creates the `cli/vX.Y.Z` tag with the release assets.

Repository administrators must configure the `release-gate` environment to require a reviewer. The `release` environment can additionally be protected for the artifact-attestation and announcement job.
