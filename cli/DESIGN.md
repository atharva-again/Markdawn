# CLI design conventions

The Markdawn CLI is both a human interface and an agent-safe API client. These rules are part of its compatibility contract.

## Command language

- Commands use `markdawn <resource> <action> [value] [flags]`, such as `markdawn page view PAGE_ID`.
- Positional values identify the resource; flags modify the action.
- Every interactive choice has a non-interactive flag or a structured failure path.
- Stable IDs are preferred in scripts. Titles are interactive conveniences.
- Both `markdawn <command> --help` and `markdawn help <command...>` show the same contextual help.

This follows GitHub CLI's resource/action language and scriptability guidance: [command structure](https://github.com/cli/cli/blob/592255318aa6a68944a534765bacbf4c52de5741/docs/primer/foundations/README.md#L5-L50) and [machine-output conventions](https://github.com/cli/cli/blob/592255318aa6a68944a534765bacbf4c52de5741/docs/primer/foundations/README.md#L177-L200).

## Output contract

- Human terminal output may use layout, color, and rendered Markdown.
- Redirected output has no ANSI sequences, headers, or truncation.
- Redirected lists are tab-separated; redirected page content is raw Markdown.
- `--json` emits one JSON value to stdout. Errors use `{ "error": { "code", "message", "details"? } }` and a non-zero exit status.
- Status and diagnostics go to stderr when they are not the requested data.

The structured-error behavior is informed by Vercel CLI's [non-interactive contract](https://github.com/vercel/vercel/blob/6aa29e5714e17d19ba10dd15c6d464cf152e49a5/packages/cli/docs/non-interactive-mode.md#L3-L36).

## Interaction and dependencies

- Huh owns password and ambiguity-selection prompts.
- Lip Gloss owns terminal styling and tables.
- Glamour renders Markdown only for an interactive terminal.
- Kong handles command parsing. Charm's own Gum CLI uses the same parser alongside its Bubble Tea and Lip Gloss components: [Gum command model](https://github.com/charmbracelet/gum/blob/716d8b5d0221558f944b5a078dbbcca8572534fb/gum.go#L1-L33) and [parser setup](https://github.com/charmbracelet/gum/blob/716d8b5d0221558f944b5a078dbbcca8572534fb/main.go#L31-L58).

The CLI does not introduce a full-screen workspace browser. Markdawn remains API-first, while focused prompts improve ambiguous human interactions without changing automation behavior.

## Safety

- Tokens are never accepted as command-line flags.
- Config files use mode `0600`; environment tokens override stored credentials.
- API tokens are REST credentials, not direct Yjs or collaboration WebSocket credentials.
- Whole-page edits use ETags and never force through a conflict.
- Exact replacements use idempotency keys and fail when the target is absent, repeated, or overlapping. `--old-text` and `--new-text` are the normal path for short agent edits; file/stdin sources remain available for multiline Markdown.
- Write operations never gain sharing, deletion, folder-management, or token-management authority.
