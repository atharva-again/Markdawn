---
title: Use Markdawn With AI Assistants
description: Connect terminal-based AI assistants to Markdawn with the CLI and scoped tokens.
---

You can use Markdawn with AI assistants that can work with a terminal. The current path uses the Markdawn CLI and its optional skill.

## How It Works

1. Install the CLI.
2. Create a named token in **Markdawn Settings → API tokens**.
3. Sign in with `markdawn login`.
4. Let the tool read or change pages through the CLI.
5. Review the result in Markdawn.

There is no separate AI notebook to keep in sync.

## Start With Read Access

New tokens are read-only by default. Read access is enough for a tool to find pages, read content, understand folders, and answer questions from existing information.

Give a token write access only when you want the tool to create or edit pages.

## Use Targeted Changes

For an edit:

1. Read the current page.
2. Identify the exact passage to change.
3. Ask the tool to replace that passage.
4. Check the result.

Do not ask a tool to rewrite an important page from memory when a targeted edit will do.

## Keep Secrets Private

Never paste your token into a chat, commit it to a repository, or put it in a command that can be saved in shell history.

See [Markdawn CLI](/agents/markdawn-cli/) for setup and the [generated API Reference](/api-reference/endpoints/) for endpoint details.
