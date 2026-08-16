---
title: Markdawn CLI
description: Use Markdawn from a terminal and give compatible AI tools a safe way to work with pages.
---

The Markdawn CLI lets you use Markdawn from a terminal. The browser and CLI use the same content layer.

## Install

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

## Sign In

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
markdawn page list
markdawn page view "Page Title"
markdawn --json page list
markdawn --json page view PAGE_ID
```

Use page IDs in scripts. Titles are convenient for interactive use but can be ambiguous.

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
