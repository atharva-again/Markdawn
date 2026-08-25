---
title: Markdawn MCP Support
description: Connect MCP clients to Markdawn through the hosted OAuth gateway.
---

Markdawn exposes a remote MCP gateway at:

```text
https://mcp.markdawn.space/mcp
```

The gateway uses Better Auth's OAuth provider. OAuth bearer tokens terminate at
the MCP service; the service sends only a short-lived HMAC-signed user and
connection context to the API's `/api/v1` boundary. The API checks the signed
token hash, expiry, session, refresh-grant state, and workspace authorization.

The gateway is Bearer-only. DPoP-bound tokens and DPoP proofs are rejected
because the downstream API call uses the signed private context.

Access-token revocation is enforced at the private API boundary. An already
established MCP transport may remain open until its next API operation; that
operation returns the clear `invalid_token` authentication error, and the
client should discard the token and restart OAuth rather than retrying it.

## Permissions

- `pages:read` — read pages and folders
- `pages:write` — create, modify, move, import, and delete pages and folders;
  request it together with `pages:read`

Protocol scopes such as `openid`, `profile`, and `offline_access` are handled
internally and are not shown as workspace permissions.

## Client registration and authorization

Client ID Metadata Documents are supported through CIMD, with Dynamic Client
Registration as a compatibility fallback. MCP clients normally use OAuth
authorization code with S256 PKCE. The user is redirected to Markdawn's login
page and then to the MCP consent page.

## Local development

```dotenv
MCP_PUBLIC_URL=http://localhost:3002
MCP_PORT=3002
MCP_API_URL=http://127.0.0.1:3001
MCP_API_INTERNAL_SECRET=development-only-mcp-api-secret-0123456789abcdef
BETTER_AUTH_ISSUER=http://localhost:5173/api/auth
BETTER_AUTH_JWKS_URL=http://127.0.0.1:3001/api/auth/jwks
```

HTTP MCP URLs are accepted only for `localhost`, `127.0.0.1`, and `::1`.
Non-loopback MCP URLs must use HTTPS.

The gateway serves the MCP `2026-07-28` protocol through the official MCP v2
server package and rejects legacy protocol traffic. MCP protocol `POST`
requests are accepted only at `/mcp`; health and OAuth endpoints use their
documented `/api/...` paths.

## Available tools

MCP exposes workspace capabilities covering identity, pages, folders, Trash,
import, and export. CLI-local features such as login, shell completion, skill
installation, and local filesystem paths remain CLI-only.

Mutations preserve the API's idempotency and conflict semantics. Clients are
responsible for reconciling an `outcome_uncertain` result before retrying a
destructive or otherwise non-idempotent operation.

Folder lifecycle batches use best-effort semantics rather than an atomic
multi-folder transaction. Each item is sent as an independent API operation;
clients must inspect every batch item for a failure before assuming the whole
batch succeeded, especially when the references are related folders.
