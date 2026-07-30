# Markdawn

A knowledge base for humans and their AI agents.

Try it out at [markdawn.space](https://markdawn.space) — currently in public beta.

Notion is a human tool with an API bolted on. Obsidian is a local vault you sync. Markdawn is built different. The same product works headful in a browser and headless via REST API. Write a page in your browser. Have an agent read, edit, and link to it via the same endpoints. No wrappers, no adapters, no dual-mode.

---

## What's Built

### Editor
- Real-time collaborative editing via WebSocket (CRDT-based — concurrent edits merge cleanly)
- Markdown-first: GFM (tables, task lists, strikethrough), LaTeX math, inline code, images
- `[[Wiki links]]` to link pages — backlinks are tracked automatically
- Table of contents generated from headings
- Page titles, icons, and cover images
- Properties panel for page metadata

### Organization
- Workspaces (team or project spaces)
- Folders with nesting — create, rename, delete, move pages between them
- Search with filters (date range, parent folder)
- Command palette (`Cmd+K` / `Ctrl+K`)
- Tags, favorites, and trash
- Dark mode

### Security
- OAuth login (Google, GitHub)
- Public share links for any page via URL
- Workspace-level access control

### Import
- Obsidian vault import — wiki links, folders, and markdown files map directly
- Markdown export

### API
- Versioned REST API for browser sessions, the CLI, local agents, and integrations
- Safe exact Markdown replacements that appear live in connected browser editors
- Named read-only or write-capable API tokens
- Official Go CLI and portable agent skill

See the [API v1 guide](docs/api-v1.md), the live `/api/v1/openapi.json` contract,
the [`cli/`](cli/) source, and [`skills/markdawn/SKILL.md`](skills/markdawn/SKILL.md).

### CLI

Install Markdawn for your terminal and agents:

```sh
curl -fsSL https://markdawn.space/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://markdawn.space/install.ps1 | iex
```

The installer automatically configures PATH. Set `MARKDAWN_MODIFY_PATH=0` before installation to
opt out. PATH changes apply to new terminal sessions; open a new terminal or source your shell
profile before running `markdawn login`. The installer prints an absolute-path login command for
immediate use. The official CLI supports safe Markdown edits, structured JSON output, shell
completion, and scoped API tokens. It runs against `https://markdawn.space` by default and can
target a self-hosted server with `MARKDAWN_URL` or `--url`.

For coding agents, install the portable Markdawn skill with the optional Vercel skills tool:

```sh
markdawn skill install --global
```

To install it during the CLI bootstrap instead, set `MARKDAWN_INSTALL_SKILL=global` (or
`project`) on the installer process. This optional step requires Node.js and `npx`.

See the [CLI guide](cli/README.md) for install details, agent compatibility, and the complete
command reference.

---

## The Product Thesis

Most "AI + docs" tools are a human app with an agent API wrapper. Markdawn inverts this: the content layer works identically headful and headless. Agents aren't "supported" — they're first-class users. A page created by an agent looks exactly like a page created by a human. A wiki link from a human to an agent-created page works the same as any other link.

This means:
- No "agent mode" toggle
- No separate data stores for human vs. agent content
- No sync layer between "your notes" and "agent memory"
- The graph is unified. The API is the product.

---

## Self-Hosted

Open source under GNU AGPL v3. Run it on your own infrastructure.

- [Deployment Guide](docs/deployment_guide.md) — step-by-step for a single VPS with Caddy, Podman, and PostgreSQL
- [deploy/](deploy/) — `setup.sh` (one-time server bootstrap) and `deploy.sh` (incremental deploy)

## Local Development

```bash
cp .env.dev .env
pnpm dev
```

Both the API and collaboration service require `COLLAB_INTERNAL_SECRET`. The development
template provides a localhost-only value so a fresh checkout starts immediately. For every
non-development environment, generate and set a unique secret with `openssl rand -hex 32`.

---

## CI

Maintainers can request E2E tests from a pull request comment:

- `/e2e chromium`
- `/e2e firefox`
- `/e2e all`

---

## Author

Atharva Verma  
[GitHub](https://github.com/atharva-again/Markdawn)  
[atharva.verma18@gmail.com](mailto:atharva.verma18@gmail.com)
