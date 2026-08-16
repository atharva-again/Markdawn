---
title: Self-Hosting
description: Run Markdawn on infrastructure you control.
---

Run Markdawn on infrastructure you control.

The documented deployment path uses one Fedora VPS with Caddy, rootless Podman containers, and self-hosted PostgreSQL. This is the path covered by the included setup and deployment scripts.

Markdawn is made up of containerized application services, so an experienced operator can adapt the deployment to Ubuntu, another Linux distribution, Docker Compose, or another compatible container environment. Those deployments require manual adaptation and verification rather than using the Fedora setup script unchanged.

## Choose Your Guide

- [Deploy Markdawn on a VPS](/self-hosting/deploy-markdawn-on-a-vps/) covers the documented first installation.
- [Maintain a Self-Hosted Markdawn](/self-hosting/maintain-a-self-hosted-markdawn/) covers updates, service checks, logs, and common failures.
- [Move a Markdawn Deployment](/self-hosting/move-a-markdawn-deployment/) covers moving a compatible installation to another server.

## What You Run

- Caddy or another public reverse proxy.
- PostgreSQL 17 with persistent storage.
- The Markdawn API service.
- The Markdawn collaboration service.
- The built web application.
- Persistent storage for the database and uploads.

The API and collaboration services must be reachable through the public web origin. PostgreSQL should remain private to the application services.

## Important Data Rule

Use the checked-in database migrations. Do not use `db:push` on a database that has migration history.

## Deployment Choices

Use the documented Fedora and Podman path when you want the shortest route from a clean server to a working installation.

Use Ubuntu, Docker Compose, or another container runtime when you are comfortable translating the service definitions and maintaining the result yourself. Keep the same application boundaries, environment variables, persistent volumes, database migrations, health checks, OAuth callback paths, and collaboration WebSocket routing.
