# Markdawn API v1

Markdawn exposes one client-neutral API for the browser, official CLI, local agents, and future integrations. Existing `/api/*` browser routes remain compatibility routes; new clients should use `/api/v1/*`.

The machine-readable contract is available from `GET /api/v1/openapi.json`.

## Authentication

Browser clients may use their Better Auth session cookie. CLI and agent clients send a named token:

```http
Authorization: Bearer mdn_...
```

Tokens start with `pages:read`. A human must explicitly grant `pages:write`. Tokens inherit the owner's page access but never gain sharing, deletion, workspace-administration, folder-management, or token-management authority. Token secrets are shown only once. Expiry is optional and defaults to no expiry. Operational token audit events are retained for 90 days; they are not durable page-version history.

API tokens authenticate `/api/v1` only. They are not collaboration WebSocket credentials; API content changes are validated by the versioned API and then broadcast to connected browser editors through Markdawn's private service boundary.

## Markdown representation

`GET /api/v1/pages/:id/content` returns `text/markdown` and an `ETag` header. The Markdown consists of existing Markdawn frontmatter followed by the authored body:

```markdown
---
icon: pin
tags:
  - research
---

Authored body.
```

The page title is separate metadata. Markdawn does not generate an H1. File exports carry the title in their readable filename.

## Safe exact edits

Use `POST /api/v1/pages/:id/edits` for normal agent changes:

```json
{
  "edits": [
    {
      "id": "update-introduction",
      "oldText": "The old exact passage.",
      "newText": "The revised passage."
    }
  ]
}
```

Non-empty `oldText` must occur exactly once. Line endings are normalized to LF; all other characters match exactly. An empty `oldText` is an explicit empty-document precondition: it applies only when the current Markdown is empty, allowing a client to initialize a blank page without an ambiguous zero-length match. Non-overlapping edits are independent. A missing, repeated, overlapping, or non-empty-page target returns a per-edit conflict and does not make the server guess.

Requests support up to 100 edits for small pages. The server reduces that limit for large pages so independent validation remains within a fixed work budget; `edit_work_limit` means the edits must be split across multiple requests.

Insertion retains an exact anchor in `newText`; deletion uses an empty `newText`. Successful body changes are applied through the collaboration service as ordinary Yjs updates and appear in connected browsers without a reload.

Use `Idempotency-Key` for retryable edit requests. Completed responses are replayable for 24 hours. An incomplete reservation remains held for five minutes so an uncertain retry cannot duplicate a successful edit after a network or persistence failure. Retry `idempotency_in_progress` and transient `503` responses with the same key, honoring `Retry-After`. `idempotency_key_mismatch` means the key was reused for different input and must not be retried with that input; `idempotency_reservation_missing` indicates that the expected reservation is no longer available.

## Exact-title resolution

`GET /api/v1/pages/resolve?title=...` performs an indexed, case-insensitive exact-title lookup. Results are permission-filtered and include a server-computed `folderPath` for disambiguation; clients do not need to scan the page and folder collections or reproduce hierarchy rules.

Page and folder resources return `parentId: null` when the parent folder is not enumerable by the caller. `GET /api/v1/folders` is cursor-paginated with a default limit of 50 and a maximum limit of 100; follow `nextCursor` until it is `null`.

## Whole-page editing

Whole-page replacement is intended for `$EDITOR`, imports, and deliberate rewrites:

```http
GET /api/v1/pages/:id/content
ETag: "revision"

PUT /api/v1/pages/:id/content
Content-Type: text/markdown
If-Match: "revision"
```

The ETag is a content revision covering the authored Markdown body, properties, and icon. Changes to the title, parent folder, cover, or other page metadata do not invalidate it because content writes cannot overwrite those fields. A stale content replacement returns `409 Conflict`; reread and reconcile rather than overwriting.
