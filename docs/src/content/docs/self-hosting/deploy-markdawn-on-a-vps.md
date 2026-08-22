---
title: Deploy Markdawn On A Fedora VPS
description: Deploy Markdawn on a Fedora VPS with Caddy, rootless Podman, PostgreSQL, OAuth, persistent storage, and database migrations.
---

This guide documents the maintained deployment path for one Fedora VPS with Caddy, rootless Podman, and PostgreSQL.

Follow this guide when you want a documented first installation. It assumes you can manage DNS, open firewall ports, edit environment values, and use `sudo` on the server.

## Prerequisites

Prepare:

- A Fedora 44 VPS with at least 4 GB of RAM.
- A domain or subdomain pointing to the VPS IP address.
- A deployment user with `sudo` access.
- Google and GitHub OAuth applications if you want social login.

Open ports 80 and 443 so Caddy can receive web traffic and obtain a certificate.

## Other Linux Distributions And Docker Compose

The setup script targets Fedora and Podman. It is not a requirement imposed by the application.

An adapted deployment needs to provide:

- PostgreSQL with persistent storage.
- The Markdawn API.
- The collaboration service with WebSocket support.
- The built web application.
- A reverse proxy for the public origin, API routes, and `/collab` WebSocket traffic.
- The environment variables from `.env.production`.
- Persistent storage for the database and uploads.
- `db:migrate` before the application accepts traffic.

The included scripts do not manage every alternative environment. If you use Docker Compose or Ubuntu, adapt the service definitions and maintain the deployment yourself.

## Run The Setup Script

Run these commands on the documented Fedora server as a non-root user:

```bash
curl -fsSL https://raw.githubusercontent.com/atharva-again/Markdawn/master/deploy/setup.sh -o setup.sh
chmod +x setup.sh
./setup.sh
```

The script prompts you to edit `.env`, installs required tools, creates persistent storage, builds the services, applies database migrations, and starts the application.

### Custom domains

The checked-in Caddy configuration serves the application at `app.markdawn.space`. The public marketing site is hosted separately. The setup script copies the Caddy file to `/etc/caddy/Caddyfile`; setting `FRONTEND_URL` does not change the Caddy hostname automatically. Custom domains therefore require a manual Caddyfile edit.

For a custom deployment, rename the `app.markdawn.space` site block to your domain in `deploy/Caddyfile` before running the setup script when using an existing checkout, or make the same edit after setup. The app site block includes compatibility redirects from legacy `/app/...` paths to root-based paths.

```sh
sudoedit /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Replace the site addresses with the domain that points to the VPS. For a root-based self-hosted deployment, use that domain in `FRONTEND_URL`, `CORS_ORIGINS`, `VITE_API_URL`, and the OAuth redirect URLs below. Caddy must be able to resolve the domain and reach ports 80 and 443 to obtain its certificate.

## Configure Environment Values

At minimum, review:

```text
POSTGRES_USER
POSTGRES_PASSWORD
POSTGRES_DB
DATABASE_URL
BETTER_AUTH_SECRET
FRONTEND_URL
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
CORS_ORIGINS
NODE_ENV
PORT
COLLAB_PORT
VITE_API_URL
```

Use a secret of at least 32 characters for `BETTER_AUTH_SECRET`. Create a unique `COLLAB_INTERNAL_SECRET` of at least 32 characters. Do not reuse example passwords or commit `.env`.

The incremental deployment script migrates exact legacy hosted values from `markdawn.space` to `app.markdawn.space` for `FRONTEND_URL`, `CORS_ORIGINS`, and `VITE_API_URL`, and removes the obsolete `VITE_APP_URL` setting. Custom environment values are left unchanged; review `.env` before deploying. Normal application deployments do not modify Caddy.

To apply the checked-in Caddy changes explicitly, review and run:

```sh
sudo /var/www/markdawn/deploy/update-caddy.sh
```

This command validates the repository configuration, backs up the installed configuration, installs the new file, reloads Caddy, and verifies that the service remains active. It intentionally replaces `/etc/caddy/Caddyfile`; merge custom domains and rules into `deploy/Caddyfile` first.

## Configure OAuth Redirects

Register these redirect URLs for your domain:

```text
https://your-domain.example/api/auth/callback/google
https://your-domain.example/api/auth/callback/github
```

The URLs must match the provider configuration exactly.

## Verify The Deployment

```bash
curl https://your-domain.example/api/health
```

A healthy service returns a JSON response with `status` set to `ok`. Then open the domain and sign in.

After signing in, verify one page can be created and edited in the browser. If you use collaborative editing, open a second browser session and confirm that changes appear in both sessions.

## If Setup Fails

```bash
journalctl --user -u markdawn-postgres.service --no-pager
journalctl --user -u markdawn-api.service --no-pager
journalctl --user -u markdawn-collab.service --no-pager
```

For later updates and migration safety, see [Maintain a Self-Hosted Markdawn](/self-hosting/maintain-a-self-hosted-markdawn/). To move the installation, see [Move a Markdawn Deployment](/self-hosting/move-a-markdawn-deployment/).
