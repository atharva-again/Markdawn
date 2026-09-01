---
title: 'Markdawn CLI: Install And Manage Pages'
description: Install the Markdawn CLI, sign in with a scoped token, read and edit pages, import and export markdown, and connect AI assistants.
---

The Markdawn CLI lets you use Markdawn from a terminal. The browser and CLI use the same content layer, so a page created or edited by the CLI appears in the browser.

## Before You Begin

You need a Markdawn account and a named API token from **Markdawn Settings → API tokens**. The token is shown only when it is created. Keep it private.

## Install The CLI

On Linux and macOS:

```sh
curl -fsSL https://markdawn.space/install.sh | sh
```

On Windows PowerShell:

```powershell
irm https://markdawn.space/install.ps1 | iex
```

The installer adds the CLI directory to your shell profile, but profile changes apply only to future sessions. Open a new terminal, or reload the appropriate profile (`source ~/.bashrc`, `source ~/.zshrc`, or `. $PROFILE` in PowerShell), before invoking `markdawn` by name.

Check the installation:

```sh
markdawn --version
```

You should see the installed CLI version. If the command is not found, open a new terminal or reload the profile that the installer changed.

## Sign In To Markdawn

Create a named token in **Markdawn Settings → API tokens**, then run:

```sh
markdawn login
```

For a self-hosted server:

```sh
markdawn login --url https://your-markdawn.example.com
```

Check the connection without printing the token:

```sh
markdawn whoami
markdawn doctor
```

## Read Pages

```sh
markdawn page search "project notes"
markdawn page list
markdawn page view "Page Title"
markdawn --json page search "project notes"
markdawn --json page list
markdawn --json page view PAGE_ID
```

`page search` searches page titles only and returns at most 20 matching pages, including their
folder paths. Use a returned page ID with `page view` or another page command. Use page IDs in
scripts; titles are convenient for interactive use but can be ambiguous.

## Create And Edit Pages

```sh
markdawn page create --title "Research Notes" --content-file notes.md
```

For a small, targeted change:

```sh
markdawn page edit exact PAGE_ID \
  --old-text "The old exact passage." \
  --new-text "The revised passage."
```

Read the page immediately before editing. The CLI refuses to guess if the passage is missing, repeated, or changed.

## Import And Export

```sh
markdawn import page notes.md
markdawn import folder ./notes
markdawn export page PAGE_ID --output page.md
markdawn export all --output markdawn-export.zip
```

## Agent Skill

Install the Markdawn skill for tools that support Agent Skills:

```sh
markdawn skill install
```

The skill gives supported tools instructions for safe page discovery and exact edits. It does not create a separate copy of your pages.

## Keep Tokens Safe

Do not paste a token into a chat, commit it to a repository, or put it directly in a command that could be saved in shell history. For non-interactive use, set `MARKDAWN_TOKEN` and, for a self-hosted server, `MARKDAWN_URL` in the environment.

## Related Guides

- [Connect AI Assistants To Markdawn](/agents/use-markdawn-with-ai-assistants/) explains read and write access.
- [Markdown Support In Markdawn](/getting-started/markdown-support/) lists supported content syntax.
- [API Reference](/api-reference/endpoints/) documents the direct HTTP interface.
