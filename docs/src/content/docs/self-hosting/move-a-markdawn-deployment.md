---
title: Move A Self-Hosted Markdawn Deployment
description: Move a self-hosted Markdawn installation, PostgreSQL data, uploads, environment values, and DNS to another compatible server.
---

Use this runbook to move a compatible Markdawn installation from one Linux server to another.

The goal is a new server with the same application services and persistent data. Keep the old server stopped until you have verified the new deployment.

The documented commands assume Fedora, rootless Podman, external DNS, and administrative access on both servers. If the source or destination uses Ubuntu, Docker Compose, or another container runtime, adapt the service and volume commands while preserving the same application services and persistent data.

## Prepare The New Server

Clone the repository and copy the existing environment file:

```bash
sudo dnf install -y git
sudo mkdir -p /var/www
sudo chown "$USER:$USER" /var/www
git clone https://github.com/atharva-again/Markdawn.git /var/www/markdawn
scp old-server:/var/www/markdawn/.env /var/www/markdawn/.env
cd /var/www/markdawn
./deploy/setup.sh
```

Verify the new deployment, then stop its application services before restoring data.

## Capture The Old Data

Stop writes before taking final snapshots:

```bash
systemctl --user stop markdawn-api.service markdawn-collab.service
podman exec markdawn-postgres pg_dump -U markdawn -d markdawn \
  --format=custom --no-owner > /tmp/markdawn-db.dump
podman volume export markdawn-data > /tmp/markdawn-data.tar
```

Copy both snapshots to the new server.

## Restore The Data

```bash
cat /tmp/markdawn-db.dump | podman exec -i markdawn-postgres \
  pg_restore -U markdawn -d markdawn --clean --if-exists --no-owner
podman volume import markdawn-data /tmp/markdawn-data.tar
```

Apply migrations and restart the services:

```bash
cd /var/www/markdawn
pnpm --filter @markdawn/api db:migrate
systemctl --user start markdawn-api.service markdawn-collab.service
curl http://localhost:3001/api/health
```

## Cut Over DNS

1. Point the domain's DNS records to the new server.
2. Restart Caddy.
3. Check the public API and collaborative editing.
4. Keep the old server stopped until the new server is confirmed healthy.

Keep the old server and both snapshots available until you have verified pages, uploads, login, sharing, and editing.

For routine updates instead of a server move, use [Maintain a Self-Hosted Markdawn](/self-hosting/maintain-a-self-hosted-markdawn/).
