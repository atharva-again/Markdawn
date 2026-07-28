# Markdawn Deployment Guide

Single-VPS deployment on Fedora with Caddy reverse proxy, Podman containers, and self-hosted PostgreSQL 17.

## Quick Start (Hands-Off)

Run these commands on your VM as a non-root user with `sudo` access:

```bash
curl -fsSL https://raw.githubusercontent.com/atharva-again/Markdawn/master/deploy/setup.sh -o setup.sh
chmod +x setup.sh
./setup.sh
```

The script will prompt you to edit `.env` with your credentials during setup. After it completes, the app will be running at your configured domain.

---

## Prerequisites

- Vultr VM with Fedora 44 (4GB RAM minimum)
- Domain or subdomain pointing to VM IP (e.g., `markdawn.space`)
- Caddy installed on the VM
- GitHub and Google OAuth apps configured

## Initial Server Setup

### 1. Install Dependencies

The `setup.sh` script installs everything automatically, but if doing it manually:

```bash
sudo dnf install -y git nano curl podman
curl -fsSL https://fnm.vercel.app/install | bash
export PATH="$HOME/.local/share/fnm:$PATH"
eval "$(fnm env --shell bash)"
fnm install 24
fnm use 24
corepack enable pnpm
```

### 2. Clone Repository

```bash
sudo mkdir -p /var/www
sudo chown $USER:$USER /var/www
git clone https://github.com/atharva-again/markdawn.git /var/www/markdawn
cd /var/www/markdawn
```

### 3. Configure Environment

Copy the production template and fill in real values:

```bash
cp .env.production .env
nano .env
```

Required variables:

```bash
POSTGRES_USER=markdawn
POSTGRES_PASSWORD=your-secure-password
POSTGRES_DB=markdawn
DATABASE_URL=postgresql://markdawn:your-secure-password@localhost:5432/markdawn
BETTER_AUTH_SECRET=minimum-32-characters-secret-key
FRONTEND_URL=https://markdawn.space
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
CORS_ORIGINS=https://markdawn.space
NODE_ENV=production
PORT=3001
COLLAB_PORT=1234
VITE_API_URL=https://markdawn.space
```

`setup.sh` creates a unique `COLLAB_INTERNAL_SECRET` automatically. If configuring an
existing `.env` manually, append one with `printf '\nCOLLAB_INTERNAL_SECRET=%s\n'
"$(openssl rand -hex 32)" >> .env`. It must be unique and at least 32 characters.

### 4. Configure OAuth Providers

Register these redirect URLs in your OAuth provider dashboards:

- Google Cloud Console: `https://markdawn.space/api/auth/callback/google`
- GitHub Settings: `https://markdawn.space/api/auth/callback/github`

### 5. Build Application

```bash
pnpm install
pnpm --filter @markdawn/shared build
pnpm --filter @markdawn/web build
pnpm --filter @markdawn/api build
pnpm --filter @markdawn/collab build
```

### 6. Configure Caddy

Copy the Caddyfile and reload:

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

### 7. Start Services with Podman

```bash
./deploy/setup.sh
```

This script will:
1. Install Podman and common tools
2. Enable lingering for user systemd services
3. Create persistent Podman volumes for PostgreSQL and uploads
4. Copy Quadlet files to `~/.config/containers/systemd/`
5. Build container images
6. Start PostgreSQL and wait for it to be healthy
7. Run `db:migrate` to initialize the database schema
8. Start API and Collab systemd user services

### 8. Verify Deployment

```bash
curl https://markdawn.space/api/health
```

Expected response: `{"status":"ok","timestamp":...}`

## Future Deployments

After initial setup, fetch and execute the deployment script from the target revision before updating the working tree:

```bash
cd /var/www/markdawn
git fetch origin master
git show origin/master:deploy/deploy.sh > /tmp/markdawn-deploy.sh
bash /tmp/markdawn-deploy.sh
rm /tmp/markdawn-deploy.sh
```

Fetching only updates Git metadata. Executing the fetched script separately ensures that new pre-deployment compatibility checks run during the first rollout that introduces them; invoking an older checked-out `deploy.sh` cannot run checks added by the release it later pulls.

The script will:
1. Verify that the existing database uses the current migration baseline
2. Pull the latest code and install dependencies
3. Build the shared and web packages
4. Update Podman Quadlet units
5. Rebuild the API and collaboration container images
6. Stop the services and recreate the pod so published-port changes take effect
7. Restart PostgreSQL and wait for it to become ready
8. Apply pending database migrations
9. Start the application services and verify API health

The current Drizzle v1 baseline is not compatible with databases created from the removed legacy migration history. `deploy.sh` detects those databases before pulling code or replacing deployment artifacts and exits without resetting them.

### Resetting a Legacy Database

This procedure permanently deletes the existing PostgreSQL data. Run it only when a clean reset is intended:

```bash
cd /var/www/markdawn
systemctl --user stop markdawn-api.service markdawn-collab.service markdawn-postgres.service markdawn-pod.service
podman volume rm postgres-data
./deploy/setup.sh
```

`setup.sh` creates a fresh `postgres-data` volume and applies the current migrations. Running `setup.sh` without removing the incompatible volume does not reset the database.

## Managing Services

```bash
# View status
systemctl --user status markdawn-postgres.service markdawn-api.service markdawn-collab.service

# View logs
journalctl --user -u markdawn-postgres.service -f
journalctl --user -u markdawn-api.service -f
journalctl --user -u markdawn-collab.service -f

# Restart services
systemctl --user restart markdawn-postgres.service
systemctl --user restart markdawn-api.service
systemctl --user restart markdawn-collab.service

# Stop services
systemctl --user stop markdawn-postgres.service markdawn-api.service markdawn-collab.service

# Enable auto-start on boot
systemctl --user enable markdawn-postgres.service markdawn-api.service markdawn-collab.service
```

## Architecture

```
Vultr VPS (Fedora, 4GB RAM)
├── Caddy (systemd, host) -> reverse proxy
├── Podman Pod (markdawn.pod)
│   ├── markdawn-postgres.container (PostgreSQL 17, port 5432)
│   ├── markdawn-api.container (Hono, port 3001)
│   └── markdawn-collab.container (Hocuspocus, port 1234)
└── Persistent Volume: postgres-data
```

All containers run inside a single Podman pod sharing the `localhost` network namespace.
PostgreSQL port 5432 and the collaboration service port 1234 are bound to `127.0.0.1`
only, not exposed externally.

## Troubleshooting

### Caddy fails to get certificate

Ensure port 80 and 443 are open in the Vultr firewall and that the domain resolves to the VM IP.

### Containers fail to start

Check logs:
```bash
journalctl --user -u markdawn-api.service --no-pager
journalctl --user -u markdawn-collab.service --no-pager
```

Verify the environment file exists:
```bash
ls /var/www/markdawn/.env
```

### Database connection errors

Verify `DATABASE_URL` points to `localhost:5432` and does NOT include `sslmode=require`.
Check PostgreSQL is running:

```bash
systemctl --user status markdawn-postgres.service
podman exec markdawn-postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

### OAuth login fails

Confirm redirect URLs exactly match what's registered in the provider dashboard (including protocol and trailing slashes).

### Frontend shows blank page

Ensure `VITE_API_URL` is set before building the web package. Collaboration uses the browser's
same-origin `/collab` WebSocket route, which Caddy proxies to the collaboration service.
