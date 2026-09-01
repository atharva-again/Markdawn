import { type Document, Document as HocuspocusDocument, type Server } from '@hocuspocus/server';
import type { Logger } from '@logtape/logtape';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type CollabSession, createCollabSession } from './collabSession';
import { createConnectionLifecycle } from './connectionLifecycle';
import { revalidateActivePageConnections } from './permission-handler';
import { createCollabServer, reconcileActiveCollaborationState } from './server';
import { createTestPage, createTestSession, createTestUser, getTestPool } from './test-utils';

const logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

function accountContext(options: {
  user: { id: string; email: string; name?: string; image?: string | null };
  sessionToken: string;
  permission: CollabSession['permission'];
  accessRevision?: string | undefined;
}): CollabSession {
  return createCollabSession({
    principal: {
      kind: 'account',
      user: {
        id: options.user.id,
        email: options.user.email,
        name: options.user.name ?? 'Test User',
        avatarUrl: options.user.image ?? null,
      },
      credential: { kind: 'session', raw: options.sessionToken },
    },
    permission: options.permission,
    accessRevision: options.accessRevision ?? '0',
    lifecycle: createConnectionLifecycle(),
  });
}

describe('active permission revalidation', () => {
  const pool = getTestPool();
  let server: Server;

  beforeAll(() => {
    server = createCollabServer({
      port: 0,
      internalSecret: 'test-collaboration-internal-secret',
      pool,
      logger,
      permissionRevalidationMs: 0,
    });
  });

  afterAll(async () => {
    await server.destroy();
    await pool.end();
  });

  it('does not roll an unpersisted collaborative title back during periodic access refresh', async () => {
    const owner = await createTestUser(pool);
    const page = await createTestPage(pool, owner.id, 'Persisted old title');
    const periodicServer = createCollabServer({
      port: 0,
      internalSecret: 'test-collaboration-internal-secret',
      pool,
      logger,
      permissionRevalidationMs: 10,
    });
    const document = new HocuspocusDocument(page.id);
    document.getText('title').insert(0, 'Pending collaborative title');
    periodicServer.hocuspocus.documents.set(page.id, document);
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(document.getText('title').toString()).toBe('Pending collaborative title');
      const persisted = await pool.query<{ title: string }>(
        'select title from pages where id = $1',
        [page.id],
      );
      expect(persisted.rows[0]?.title).toBe('Persisted old title');
    } finally {
      periodicServer.hocuspocus.documents.delete(page.id);
      await periodicServer.destroy();
    }
  });

  it('canonically recovers missed permission, metadata, and deletion events', async () => {
    const owner = await createTestUser(pool);
    const viewer = await createTestUser(pool);
    const ownerSession = await createTestSession(pool, owner.id);
    const viewerSession = await createTestSession(pool, viewer.id);
    const page = await createTestPage(pool, owner.id, 'Canonical title');
    const deletedPage = await createTestPage(pool, owner.id, 'Deleted while offline');
    await pool.query(
      `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
       values ('page', $1, $2, $3, 'view')`,
      [page.id, owner.id, viewer.id],
    );
    const pageRevision = await pool.query<{ access_revision: string }>(
      'select get_page_access_revision($1)::text as access_revision',
      [page.id],
    );
    const deletedRevision = await pool.query<{ access_revision: string }>(
      'select get_page_access_revision($1)::text as access_revision',
      [deletedPage.id],
    );
    const viewerConnection = {
      context: accountContext({
        user: viewer,
        sessionToken: viewerSession.token,
        permission: 'view',
        accessRevision: pageRevision.rows[0]?.access_revision,
      }),
      readOnly: true,
      sendStateless: vi.fn(),
      close: vi.fn(),
    };
    const deletedConnection = {
      context: accountContext({
        user: owner,
        sessionToken: ownerSession.token,
        permission: 'admin',
        accessRevision: deletedRevision.rows[0]?.access_revision,
      }),
      readOnly: false,
      sendStateless: vi.fn(),
      close: vi.fn(),
    };
    const pageDocument = new HocuspocusDocument(page.id);
    const deletedDocument = new HocuspocusDocument(deletedPage.id);
    const metaDocument = new HocuspocusDocument(`page-meta:${owner.id}`);
    metaDocument.getMap('pageIndex').set(page.id, { title: 'Stale title' });
    metaDocument.getMap('pageIndex').set(deletedPage.id, { title: deletedPage.title });
    vi.spyOn(pageDocument, 'getConnections').mockReturnValue([
      viewerConnection,
    ] as unknown as ReturnType<Document['getConnections']>);
    vi.spyOn(deletedDocument, 'getConnections').mockReturnValue([
      deletedConnection,
    ] as unknown as ReturnType<Document['getConnections']>);
    server.hocuspocus.documents.set(page.id, pageDocument);
    server.hocuspocus.documents.set(deletedPage.id, deletedDocument);
    server.hocuspocus.documents.set(`page-meta:${owner.id}`, metaDocument);
    await pool.query(
      `delete from shares
       where entity_type = 'page' and entity_id = $1 and recipient_user_id = $2`,
      [page.id, viewer.id],
    );
    await pool.query('update pages set is_deleted = true where id = $1', [deletedPage.id]);
    try {
      await reconcileActiveCollaborationState(server, pool, logger);
      expect(viewerConnection.close).toHaveBeenCalledWith({ code: 4401, reason: 'Access revoked' });
      expect(deletedConnection.close).toHaveBeenCalledWith({ code: 4402, reason: 'Page deleted' });
      expect(metaDocument.getMap('pageIndex').get(page.id)).toEqual(
        expect.objectContaining({ title: 'Canonical title' }),
      );
      expect(metaDocument.getMap('pageIndex').has(deletedPage.id)).toBe(false);
    } finally {
      server.hocuspocus.documents.delete(page.id);
      server.hocuspocus.documents.delete(deletedPage.id);
      server.hocuspocus.documents.delete(`page-meta:${owner.id}`);
    }
  });

  it('disconnects a viewer after their only account grant is revoked', async () => {
    const owner = await createTestUser(pool);
    const viewer = await createTestUser(pool);
    const viewerSession = await createTestSession(pool, viewer.id);
    const page = await createTestPage(pool, owner.id);
    await pool.query(
      `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
       values ('page', $1, $2, $3, 'view')`,
      [page.id, owner.id, viewer.id],
    );
    const connection = {
      context: accountContext({
        user: viewer,
        sessionToken: viewerSession.token,
        permission: 'view',
      }),
      readOnly: true,
      sendStateless: vi.fn(),
      close: vi.fn(),
    };
    const document = new HocuspocusDocument(page.id);
    vi.spyOn(document, 'getConnections').mockReturnValue([connection] as unknown as ReturnType<
      Document['getConnections']
    >);
    server.hocuspocus.documents.set(page.id, document);
    await pool.query(
      `delete from shares
       where entity_type = 'page' and entity_id = $1 and recipient_user_id = $2`,
      [page.id, viewer.id],
    );

    try {
      await revalidateActivePageConnections(server, pool, logger);
      expect(connection.close).toHaveBeenCalledWith({ code: 4401, reason: 'Access revoked' });
    } finally {
      server.hocuspocus.documents.delete(page.id);
    }
  });

  it('disconnects page and metadata sockets when their session is deleted', async () => {
    const user = await createTestUser(pool);
    const session = await createTestSession(pool, user.id);
    const page = await createTestPage(pool, user.id);
    const pageRevision = await pool.query<{ access_revision: string }>(
      'select get_page_access_revision($1)::text as access_revision',
      [page.id],
    );
    const metaRevision = await pool.query<{ access_revision: string }>(
      'select coalesce(max(version), 0)::text as access_revision from workspace_access_versions',
    );
    const pageConnection = {
      context: accountContext({
        user,
        sessionToken: session.token,
        permission: 'admin',
        accessRevision: pageRevision.rows[0]?.access_revision,
      }),
      readOnly: false,
      sendStateless: vi.fn(),
      close: vi.fn(),
    };
    const metaConnection = {
      context: accountContext({
        user,
        sessionToken: session.token,
        permission: null,
        accessRevision: metaRevision.rows[0]?.access_revision,
      }),
      readOnly: true,
      sendStateless: vi.fn(),
      close: vi.fn(),
    };
    const pageDocument = new HocuspocusDocument(page.id);
    const metaDocument = new HocuspocusDocument(`page-meta:${user.id}`);
    vi.spyOn(pageDocument, 'getConnections').mockReturnValue([
      pageConnection,
    ] as unknown as ReturnType<Document['getConnections']>);
    vi.spyOn(metaDocument, 'getConnections').mockReturnValue([
      metaConnection,
    ] as unknown as ReturnType<Document['getConnections']>);
    server.hocuspocus.documents.set(page.id, pageDocument);
    server.hocuspocus.documents.set(`page-meta:${user.id}`, metaDocument);
    await pool.query('delete from sessions where token = $1', [session.token]);

    try {
      await revalidateActivePageConnections(server, pool, logger);
      expect(pageConnection.close).toHaveBeenCalledWith({ code: 4401, reason: 'Access revoked' });
      expect(metaConnection.close).toHaveBeenCalledWith({ code: 4401, reason: 'Session expired' });
    } finally {
      server.hocuspocus.documents.delete(page.id);
      server.hocuspocus.documents.delete(`page-meta:${user.id}`);
    }
  });
});
