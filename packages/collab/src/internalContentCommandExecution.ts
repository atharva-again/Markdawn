import { createHash } from 'node:crypto';
import type { Hocuspocus } from '@hocuspocus/server';
import type { Logger } from '@logtape/logtape';
import {
  type ApplyExactEditsCommand,
  applyExactEdits,
  type ContentAuditOperation,
  composePageMarkdown,
  type ExactEditCommandResponse,
  type InternalContentPrincipal,
  normalizeWikiLinkLookupKey,
  parsePageMarkdown,
} from '@markdawn/shared';
import { bindWikiLinkTargets } from '@markdawn/shared/markdown-yjs';
import { replaceMarkdownBody } from '@markdawn/shared/yjs-document-replacement';
import { extractWikiLinkTargetIds, yDocToMarkdown } from '@markdawn/shared/yjs-helpers';
import type { Pool } from 'pg';
import * as Y from 'yjs';
import type { PermissionQueryExecutor } from './accessVerifier';
import type { AuthenticatedCredential } from './authenticatedCredential';
import { CollabAccessError } from './collabErrors';
import { createCollabSession } from './collabSession';
import {
  type ContentCommandEffects,
  type DocumentPersistenceMutation,
  persistContentCommandEffects,
} from './contentMutationPersistence';
import { contentMetadataHash } from './contentRevision';
import type { DocumentFlushResult } from './documentFlusher';
import { createConnectionLifecycle } from './hocuspocusV3Adapter';
import { ContentCommandError, ContentConflictError } from './internalContentCommandErrors';
import type { GrantedPermissionState } from './permissionState';
import { getWikiLinkAccess, type WikiLinkAccess } from './wikiLinkAccess';

export type ParsedContentCommand =
  | { action: 'read-markdown' }
  | { action: 'replace-markdown'; markdown: string; ifMatch: string }
  | { action: 'apply-exact-edits'; command: ApplyExactEditsCommand };

type AccessVerifier = {
  assertPageAccess(
    pageId: string,
    userId: string,
    credential: AuthenticatedCredential,
    executor?: PermissionQueryExecutor,
  ): Promise<GrantedPermissionState>;
};

type PageMetadata = {
  title: string;
  properties: Record<string, unknown> | null;
  icon: string | null;
};

type PageMetadataRow = PageMetadata & { workspaceOwnerId: string | null };

export type InternalContentCommandOptions = {
  pool: Pool;
  hocuspocus: Hocuspocus;
  access: AccessVerifier;
  logger: Logger;
  internalSecret?: string;
  rejectLiveMutation(pageId: string): void;
  tryAcquireContentCommand(pageId: string): (() => void) | null;
  withDocumentMutationGate<T>(pageId: string, task: () => Promise<T>): Promise<T>;
  withDocumentContentLock<T>(pageId: string, task: () => Promise<T>): Promise<T>;
  flushDocument(
    pageId: string,
    document: Y.Doc,
    context: ReturnType<typeof createCollabSession>,
    source: 'persist',
    mutation?: DocumentPersistenceMutation,
    contentLockAlreadyHeld?: boolean,
  ): Promise<DocumentFlushResult>;
};

type AuthorizedDocument = {
  pageId: string;
  document: Y.Doc;
  metadata: PageMetadata;
  wikiLinks: WikiLinkAccess;
  session: ReturnType<typeof createCollabSession>;
  credential: Extract<AuthenticatedCredential, { kind: 'internal' }>;
  ownerId: string;
  options: InternalContentCommandOptions;
  markMutationApplied(): void;
};

function contentEtag(markdown: string): string {
  return `"${createHash('sha256').update(markdown).digest('base64url')}"`;
}

function markdownBodyFor(state: Uint8Array, wikiLinks: WikiLinkAccess): string {
  return yDocToMarkdown(state, {
    resolveWikiLinkTarget: (targetId) => {
      const path = wikiLinks.targetMarkdownPaths.get(targetId.toLowerCase());
      return path ? { title: path } : null;
    },
    restrictedWikiLinkText: 'Restricted page',
  });
}

function assertWikiLinksCanRoundTrip(document: Y.Doc, wikiLinks: WikiLinkAccess): void {
  const state = Y.encodeStateAsUpdate(document);
  for (const targetId of extractWikiLinkTargetIds(state)) {
    const normalizedTargetId = targetId.toLowerCase();
    const renderedPath = wikiLinks.targetMarkdownPaths.get(normalizedTargetId);
    const reboundTargetId = renderedPath
      ? wikiLinks.pageLookup.get(normalizeWikiLinkLookupKey(renderedPath))
      : undefined;
    if (reboundTargetId?.toLowerCase() !== normalizedTargetId) {
      throw new ContentCommandError(
        409,
        'Page contains wiki links that cannot be safely rewritten',
        'unsafe_wiki_link_rewrite',
      );
    }
  }
}

function markdownFor(document: Y.Doc, metadata: PageMetadata, wikiLinks: WikiLinkAccess): string {
  return composePageMarkdown(
    markdownBodyFor(Y.encodeStateAsUpdate(document), wikiLinks),
    metadata.properties,
    metadata.icon,
  );
}

function replaceAndBindMarkdownBody(
  document: Y.Doc,
  title: string,
  body: string,
  pageLookup: ReadonlyMap<string, string>,
): void {
  // Hocuspocus interprets truthy Yjs origins as socket connections. Content
  // commands flush explicitly, so use a non-connection origin to broadcast
  // the change without scheduling an unauthorized implicit store callback.
  replaceMarkdownBody(document, title, body, null);
  const boundState = bindWikiLinkTargets(Y.encodeStateAsUpdate(document), pageLookup);
  Y.applyUpdate(document, boundState, null);
}

function tokenAudit(
  credential: Extract<AuthenticatedCredential, { kind: 'internal' }>,
  ownerId: string,
  operation: ContentAuditOperation,
  result: 'success' | 'conflict',
): ContentCommandEffects['tokenAudit'] {
  return credential.tokenId
    ? { tokenId: credential.tokenId, ownerId, operation, result }
    : undefined;
}

async function persistStandaloneEffects(
  pool: Pool,
  pageId: string,
  effects: ContentCommandEffects,
): Promise<void> {
  if (!effects.tokenAudit && !effects.idempotency) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await persistContentCommandEffects(client, pageId, effects);
    await client.query('COMMIT');
  } catch (error) {
    // A failed effects transaction must not partially commit audit or
    // idempotency state. Preserve both failures if rollback itself fails.
    await client.query('ROLLBACK').catch((rollbackError: unknown) => {
      throw new AggregateError([error, rollbackError], 'Command effects and rollback failed');
    });
    throw error;
  } finally {
    client.release();
  }
}

function committedState(result: DocumentFlushResult): Uint8Array {
  if (result.status === 'persisted') return result.state;
  if (result.status === 'stale') throw new ContentConflictError('Page changed during the edit');
  const status = result.reason === 'oversized' ? 413 : result.reason === 'unauthorized' ? 403 : 500;
  throw new ContentCommandError(status, `Content persistence was skipped: ${result.reason}`);
}

async function readMarkdownCommand(context: AuthorizedDocument) {
  const markdown = markdownFor(context.document, context.metadata, context.wikiLinks);
  return { markdown, etag: contentEtag(markdown) };
}

async function replaceMarkdownCommand(
  context: AuthorizedDocument,
  command: Extract<ParsedContentCommand, { action: 'replace-markdown' }>,
) {
  const currentMarkdown = markdownFor(context.document, context.metadata, context.wikiLinks);
  const currentEtag = contentEtag(currentMarkdown);
  if (command.ifMatch !== currentEtag) {
    const audit = tokenAudit(
      context.credential,
      context.ownerId,
      'page.content.replace',
      'conflict',
    );
    if (audit) {
      await persistStandaloneEffects(context.options.pool, context.pageId, { tokenAudit: audit });
    }
    throw new ContentConflictError('Page changed since it was read', currentEtag);
  }
  assertWikiLinksCanRoundTrip(context.document, context.wikiLinks);
  const parsed = parsePageMarkdown(command.markdown);
  replaceAndBindMarkdownBody(
    context.document,
    context.metadata.title,
    parsed.body,
    context.wikiLinks.pageLookup,
  );
  context.markMutationApplied();
  const audit = tokenAudit(context.credential, context.ownerId, 'page.content.replace', 'success');
  const mutation: DocumentPersistenceMutation = {
    expectedMetadataHash: contentMetadataHash(context.metadata),
    metadata: { properties: parsed.properties, icon: parsed.icon },
    ...(audit ? { tokenAudit: audit } : {}),
  };
  const state = committedState(
    await context.options.flushDocument(
      context.pageId,
      context.document,
      context.session,
      'persist',
      mutation,
      true,
    ),
  );
  return {
    etag: contentEtag(
      composePageMarkdown(
        markdownBodyFor(state, context.wikiLinks),
        parsed.properties,
        parsed.icon,
      ),
    ),
  };
}

async function applyExactEditsCommand(
  context: AuthorizedDocument,
  command: Extract<ParsedContentCommand, { action: 'apply-exact-edits' }>,
): Promise<ExactEditCommandResponse> {
  const currentMarkdown = markdownFor(context.document, context.metadata, context.wikiLinks);
  const applied = applyExactEdits(currentMarkdown, command.command.edits);
  const response: ExactEditCommandResponse = {
    results: applied.results,
    etag: contentEtag(currentMarkdown),
  };
  if (!applied.results.some((result) => result.status === 'applied')) {
    const audit = tokenAudit(context.credential, context.ownerId, 'page.content.edit', 'conflict');
    await persistStandaloneEffects(context.options.pool, context.pageId, {
      ...(audit ? { tokenAudit: audit } : {}),
      ...(command.command.idempotency
        ? {
            idempotency: {
              ...command.command.idempotency,
              principalKey: context.credential.idempotencyPrincipal,
              response,
            },
          }
        : {}),
    });
    return response;
  }
  assertWikiLinksCanRoundTrip(context.document, context.wikiLinks);
  const parsed = applied.parsedMarkdown;
  if (!parsed) throw new Error('Applied exact edits are missing parsed Markdown');
  replaceAndBindMarkdownBody(
    context.document,
    context.metadata.title,
    parsed.body,
    context.wikiLinks.pageLookup,
  );
  context.markMutationApplied();
  const audit = tokenAudit(context.credential, context.ownerId, 'page.content.edit', 'success');
  const mutation: DocumentPersistenceMutation = {
    expectedMetadataHash: contentMetadataHash(context.metadata),
    metadata: { properties: parsed.properties, icon: parsed.icon },
    prepareCommittedState: (state) => {
      response.etag = contentEtag(
        composePageMarkdown(
          markdownBodyFor(state, context.wikiLinks),
          parsed.properties,
          parsed.icon,
        ),
      );
    },
    ...(audit ? { tokenAudit: audit } : {}),
    ...(command.command.idempotency
      ? {
          idempotency: {
            ...command.command.idempotency,
            principalKey: context.credential.idempotencyPrincipal,
            response,
          },
        }
      : {}),
  };
  committedState(
    await context.options.flushDocument(
      context.pageId,
      context.document,
      context.session,
      'persist',
      mutation,
      true,
    ),
  );
  return response;
}

async function executeCommand(context: AuthorizedDocument, command: ParsedContentCommand) {
  if (command.action === 'read-markdown') return readMarkdownCommand(context);
  if (command.action === 'replace-markdown') return replaceMarkdownCommand(context, command);
  return applyExactEditsCommand(context, command);
}

async function executeAuthorizedPageDocument(
  options: InternalContentCommandOptions,
  pageId: string,
  principal: InternalContentPrincipal,
  command: ParsedContentCommand,
): Promise<unknown> {
  const userResult = await options.pool.query<{
    id: string;
    email: string;
    name: string;
    avatarUrl: string | null;
  }>(
    `select id, email, name, image as "avatarUrl"
     from users where id = $1 limit 1`,
    [principal.userId],
  );
  const user = userResult.rows[0];
  if (!user) throw new ContentCommandError(401, 'Unauthorized');
  const credential = {
    kind: 'internal',
    raw: principal.requestId,
    tokenId: principal.tokenId,
    idempotencyPrincipal: principal.idempotencyPrincipal,
  } satisfies AuthenticatedCredential;
  const access = await options.access.assertPageAccess(pageId, user.id, credential);
  if (command.action !== 'read-markdown' && access.permission === 'view') {
    throw new ContentCommandError(403, 'Page is read-only');
  }
  const session = createCollabSession({
    principal: { kind: 'account', user, credential },
    permission: access.permission,
    accessRevision: access.accessRevision,
    lifecycle: createConnectionLifecycle(),
  });
  const connection = await options.hocuspocus.openDirectConnection(pageId, session);
  let mutationApplied = false;
  let result: unknown;
  try {
    const document = connection.document;
    if (!document) throw new Error('Collaboration document is unavailable');
    result = await options.withDocumentContentLock(pageId, async () => {
      const metadataResult = await options.pool.query<PageMetadataRow>(
        `select title, properties, icon,
                coalesce(get_root_folder_owner(parent_id), created_by) as "workspaceOwnerId"
         from pages where id = $1 and is_deleted = false`,
        [pageId],
      );
      const metadata = metadataResult.rows[0];
      if (!metadata?.workspaceOwnerId) throw new CollabAccessError();
      const wikiLinks = await getWikiLinkAccess(options.pool, metadata.workspaceOwnerId, user.id);
      const execute = () =>
        executeCommand(
          {
            pageId,
            document,
            metadata,
            wikiLinks,
            session,
            credential,
            ownerId: user.id,
            options,
            markMutationApplied: () => {
              mutationApplied = true;
            },
          },
          command,
        );
      return command.action === 'read-markdown'
        ? execute()
        : options.withDocumentMutationGate(pageId, execute);
    });
  } catch (error) {
    if (mutationApplied) options.rejectLiveMutation(pageId);
    try {
      await connection.disconnect();
    } catch (disconnectError) {
      // Disconnect is best-effort cleanup after a failed command. Preserve
      // the command failure and report the independent cleanup failure.
      options.logger.warn(`[internal-content] disconnect failed: ${disconnectError}`);
    }
    throw error;
  }
  try {
    await connection.disconnect();
  } catch (disconnectError) {
    // The command and its persistence already succeeded. Disconnect is a
    // cleanup boundary, so report the leak without turning success uncertain.
    options.logger.warn(`[internal-content] disconnect failed after success: ${disconnectError}`);
  }
  return result;
}

export async function withAuthorizedPageDocument(
  options: InternalContentCommandOptions,
  pageId: string,
  principal: InternalContentPrincipal,
  command: ParsedContentCommand | (() => Promise<ParsedContentCommand>),
): Promise<unknown> {
  const release = options.tryAcquireContentCommand(pageId);
  if (!release) {
    throw new ContentCommandError(
      503,
      'Collaboration command capacity exceeded',
      'collaboration_busy',
      1,
    );
  }
  try {
    const parsedCommand = typeof command === 'function' ? await command() : command;
    return await executeAuthorizedPageDocument(options, pageId, principal, parsedCommand);
  } finally {
    release();
  }
}
