---
title: Maintain A Self-Hosted Markdawn
description: Check Markdawn services, update a self-hosted installation, protect migration history, and recover from common deployment failures.
---

Use this guide after the first deployment to check services, update the application, and recover from common failures.

Keep a recent database backup and an accessible copy of your environment file before updates. Do not put the environment file or API tokens in a repository.

## Check Service Status

```bash
systemctl --user status markdawn-postgres.service markdawn-api.service markdawn-collab.service
```

## Read Logs

```bash
journalctl --user -u markdawn-api.service -f
journalctl --user -u markdawn-collab.service -f
journalctl --user -u markdawn-postgres.service -f
```

## Update The Application

After the first deployment, fetch and run the deployment script from the target revision:

```bash
cd /var/www/markdawn
git fetch origin master
git show origin/master:deploy/deploy.sh > /tmp/markdawn-deploy.sh
bash /tmp/markdawn-deploy.sh
rm /tmp/markdawn-deploy.sh
```

The update script pulls code, installs dependencies, builds packages, updates Podman units, applies pending migrations, restarts services, and checks API health.

The current Drizzle v1 baseline is not compatible with databases created from the removed legacy migration history. `deploy.sh` checks this before pulling code or replacing deployment artifacts and exits without resetting an incompatible database.

### Reset An Incompatible Database

This permanently deletes the existing PostgreSQL data. Run it only when a clean reset is intended:

```bash
cd /var/www/markdawn
systemctl --user stop markdawn-api.service markdawn-collab.service markdawn-postgres.service markdawn-pod.service
podman volume rm postgres-data
./deploy/setup.sh
```

`setup.sh` creates a fresh `postgres-data` volume and applies the current migrations. Running `setup.sh` without removing the incompatible volume does not reset the database.

## Check The Public API

```bash
curl https://your-domain.example/api/health
```

## Common Problems

### Caddy Cannot Get A Certificate

Confirm that the domain resolves to the VPS and ports 80 and 443 are open.

### Containers Do Not Start

Check service logs and confirm that `/var/www/markdawn/.env` exists.

### Database Connection Errors

Confirm that `DATABASE_URL` points to `localhost:5432` and does not include `sslmode=require`.

```bash
systemctl --user status markdawn-postgres.service
podman exec markdawn-postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

### OAuth Login Fails

Compare the callback URL in the provider dashboard with the URL configured in Markdawn. The protocol, domain, path, and trailing slash must match.

### The Browser Shows A Blank Page

Confirm that `VITE_API_URL` was set before building the web package. Caddy must proxy the same-origin `/collab` WebSocket route to the collaboration service.

## Migration Safety

Do not use `db:push` on a migrated database. Use the checked-in schema migrations and run `db:migrate` through the deployment workflow.

For a server move, follow [Move a Markdawn Deployment](/self-hosting/move-a-markdawn-deployment/). For a first installation, return to [Deploy Markdawn on a Fedora VPS](/self-hosting/deploy-markdawn-on-a-vps/).
