import {
  Document,
  type onLoadDocumentPayload,
  type onStoreDocumentPayload,
  type Server,
} from '@hocuspocus/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createCollabServer, publishPageRename } from './server';
import {
  createAccountHookContext,
  createConnectionConfig,
  createMockLogger,
  createUnverifiedAccountHookContext,
} from './serverTestHarness';
import { createTestPage, createTestUser, getTestPool } from './test-utils';

describe('collab server metadata loading', () => {
  const pool = getTestPool();
  const logger = createMockLogger();
  let server: Server;

  beforeAll(async () => {
    server = createCollabServer({
      port: 0,
      internalSecret: 'test-collaboration-internal-secret',
      pool,
      logger,
      debounceMs: 50,
      maxDebounceMs: 100,
      permissionRevalidationMs: 0,
    });
    await server.listen();
  });

  afterAll(async () => {
    await server.destroy();
    await pool.end();
  });

  it('rejects loading when user context is missing', async () => {
    const payload: onLoadDocumentPayload = {
      context: {},
      document: new Document(crypto.randomUUID()),
      documentName: crypto.randomUUID(),
      instance: server.hocuspocus,
      requestHeaders: {},
      requestParameters: new URLSearchParams(),
      socketId: crypto.randomUUID(),
      connectionConfig: createConnectionConfig(),
    };
    await expect(server.hocuspocus.hooks('onLoadDocument', payload)).rejects.toThrow(
      'Unauthorized',
    );
  });

  it('returns early for invalid non-uuid document names', async () => {
    const payload: onLoadDocumentPayload = {
      context: createUnverifiedAccountHookContext(crypto.randomUUID()),
      document: new Document('not-a-uuid'),
      documentName: 'not-a-uuid',
      instance: server.hocuspocus,
      requestHeaders: {},
      requestParameters: new URLSearchParams(),
      socketId: crypto.randomUUID(),
      connectionConfig: createConnectionConfig(),
    };
    await expect(server.hocuspocus.hooks('onLoadDocument', payload)).resolves.toBeUndefined();
    expect(logger.debug).toHaveBeenCalledWith('skipping non-meta, non-UUID room: not-a-uuid');
  });

  it('rebuilds an authenticated user metadata room from PostgreSQL', async () => {
    const user = await createTestUser(pool);
    const page = await createTestPage(pool, user.id, 'Metadata page');
    const documentName = `page-meta:${user.id}`;
    const document = new Document(documentName);
    await server.hocuspocus.hooks('onLoadDocument', {
      context: await createAccountHookContext(pool, user.id),
      document,
      documentName,
      instance: server.hocuspocus,
      requestHeaders: {},
      requestParameters: new URLSearchParams(),
      socketId: crypto.randomUUID(),
      connectionConfig: createConnectionConfig(),
    });
    expect(document.getMap('pageIndex').get(page.id)).toEqual(
      expect.objectContaining({ title: 'Metadata page' }),
    );
  });

  it('redacts hidden parent ids in rebuilt and incremental page metadata', async () => {
    const owner = await createTestUser(pool);
    const recipient = await createTestUser(pool);
    const parentId = crypto.randomUUID();
    await pool.query(
      `insert into folders (
         id, name, position, created_by, public_permission, created_at, updated_at
       ) values ($1, 'Hidden Public Parent', '0', $2, 'view', now(), now())`,
      [parentId, owner.id],
    );
    const page = await createTestPage(pool, owner.id, 'Directly Shared Child');
    await pool.query('update pages set parent_id = $1 where id = $2', [parentId, page.id]);
    await pool.query(
      `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
       values ('page', $1, $2, $3, 'view')`,
      [page.id, owner.id, recipient.id],
    );

    const metaRoomName = `page-meta:${recipient.id}`;
    const metaDocument = new Document(metaRoomName);
    await server.hocuspocus.hooks('onLoadDocument', {
      context: await createAccountHookContext(pool, recipient.id),
      document: metaDocument,
      documentName: metaRoomName,
      instance: server.hocuspocus,
      requestHeaders: {},
      requestParameters: new URLSearchParams(),
      socketId: crypto.randomUUID(),
      connectionConfig: createConnectionConfig(),
    });
    expect(metaDocument.getMap('pageIndex').get(page.id)).toEqual(
      expect.objectContaining({ parentId: null }),
    );

    server.hocuspocus.documents.set(metaRoomName, metaDocument);
    const pageDocument = new Document(page.id);
    pageDocument.getText('content').insert(0, 'owner update');
    const storePayload: onStoreDocumentPayload = {
      clientsCount: 1,
      context: await createAccountHookContext(pool, owner.id, 'edit'),
      document: pageDocument,
      documentName: page.id,
      instance: server.hocuspocus,
      requestHeaders: {},
      requestParameters: new URLSearchParams(),
      socketId: crypto.randomUUID(),
    };
    try {
      await server.hocuspocus.hooks('onStoreDocument', storePayload);
      expect(metaDocument.getMap('pageIndex').get(page.id)).toEqual(
        expect.objectContaining({ parentId: null }),
      );
      await pool.query(
        `insert into folder_public_access_visits (
           folder_id, user_id, first_seen_at, last_seen_at
         ) values ($1, $2, now(), now())`,
        [parentId, recipient.id],
      );
      await server.hocuspocus.hooks('onStoreDocument', storePayload);
      expect(metaDocument.getMap('pageIndex').get(page.id)).toEqual(
        expect.objectContaining({ parentId }),
      );
    } finally {
      server.hocuspocus.documents.delete(metaRoomName);
    }
  });

  it('excludes stale public visits after access is revoked', async () => {
    const owner = await createTestUser(pool);
    const recipient = await createTestUser(pool);
    const livePage = await createTestPage(pool, owner.id, 'Live direct share');
    const revokedPage = await createTestPage(pool, owner.id, 'Revoked public page');
    const stalePage = await createTestPage(pool, owner.id, 'Stale public visit');
    await pool.query(
      `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
       values ('page', $1, $2, $3, 'view')`,
      [livePage.id, owner.id, recipient.id],
    );
    await pool.query(
      `insert into page_public_access_visits (page_id, user_id)
       values ($1, $3), ($2, $3)`,
      [revokedPage.id, stalePage.id, recipient.id],
    );

    const documentName = `page-meta:${recipient.id}`;
    const document = new Document(documentName);
    await server.hocuspocus.hooks('onLoadDocument', {
      context: await createAccountHookContext(pool, recipient.id),
      document,
      documentName,
      instance: server.hocuspocus,
      requestHeaders: {},
      requestParameters: new URLSearchParams(),
      socketId: crypto.randomUUID(),
      connectionConfig: createConnectionConfig(),
    });
    expect(document.getMap('pageIndex').has(livePage.id)).toBe(true);
    expect(document.getMap('pageIndex').has(revokedPage.id)).toBe(false);
    expect(document.getMap('pageIndex').has(stalePage.id)).toBe(false);

    server.hocuspocus.documents.set(documentName, document);
    try {
      await publishPageRename(server.hocuspocus, pool, revokedPage.id, 'Revoked renamed', logger);
      await publishPageRename(server.hocuspocus, pool, stalePage.id, 'Stale renamed', logger);
      expect(document.getMap('pageIndex').has(revokedPage.id)).toBe(false);
      expect(document.getMap('pageIndex').has(stalePage.id)).toBe(false);
    } finally {
      server.hocuspocus.documents.delete(documentName);
    }
  });

  it('periodically invalidates dashboard metadata after access changes', async () => {
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const periodicServer = createCollabServer({
      port: 0,
      internalSecret: 'test-collaboration-internal-secret',
      pool,
      logger: createMockLogger(),
      permissionRevalidationMs: 1_000,
    });
    const owner = await createTestUser(pool);
    const recipient = await createTestUser(pool);
    const directPage = await createTestPage(pool, owner.id, 'Revoked direct grant');
    const publicPage = await createTestPage(pool, owner.id, 'Revoked public access');
    const fallbackPage = await createTestPage(pool, owner.id, 'Edit falling back to view');
    const folderId = crypto.randomUUID();
    await pool.query(
      `insert into folders (id, name, position, created_by, created_at, updated_at)
       values ($1, 'Shared folder', '0', $2, now(), now())`,
      [folderId, owner.id],
    );
    await pool.query('update pages set parent_id = $1 where id = $2', [folderId, fallbackPage.id]);
    await pool.query(
      `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
       values ('page', $1, $2, $3, 'view')`,
      [directPage.id, owner.id, recipient.id],
    );
    await pool.query("update pages set public_permission = 'view' where id = $1", [publicPage.id]);
    await pool.query(
      `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
       values ('folder', $1, $3, $4, 'view'), ('page', $2, $3, $4, 'edit')`,
      [folderId, fallbackPage.id, owner.id, recipient.id],
    );
    await pool.query('insert into page_public_access_visits (page_id, user_id) values ($1, $2)', [
      publicPage.id,
      recipient.id,
    ]);

    const documentName = `page-meta:${recipient.id}`;
    const document = new Document(documentName);
    try {
      await periodicServer.hocuspocus.hooks('onLoadDocument', {
        context: await createAccountHookContext(pool, recipient.id),
        document,
        documentName,
        instance: periodicServer.hocuspocus,
        requestHeaders: {},
        requestParameters: new URLSearchParams(),
        socketId: crypto.randomUUID(),
        connectionConfig: createConnectionConfig(),
      });
      periodicServer.hocuspocus.documents.set(documentName, document);
      const reconciled = new Promise<void>((resolve) => {
        const versions = document.getMap<number>('accessVersion');
        const observer = () => {
          versions.unobserve(observer);
          resolve();
        };
        versions.observe(observer);
      });
      await pool.query(
        "delete from shares where entity_type = 'page' and entity_id = any($1::uuid[])",
        [[directPage.id, fallbackPage.id]],
      );
      await pool.query('update pages set public_permission = null where id = $1', [publicPage.id]);
      await vi.advanceTimersByTimeAsync(1_000);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          reconciled,
          new Promise<never>((_resolve, reject) => {
            timeout = realSetTimeout(
              () => reject(new Error('Timed out waiting for metadata reconciliation')),
              5_000,
            );
          }),
        ]);
      } finally {
        if (timeout) realClearTimeout(timeout);
      }
      expect(document.getMap('pageIndex').has(directPage.id)).toBe(false);
      expect(document.getMap('pageIndex').has(publicPage.id)).toBe(false);
      expect(document.getMap('pageIndex').has(fallbackPage.id)).toBe(true);
      expect(document.getMap('accessPermissions').get(fallbackPage.id)).toBe('view');
      expect(document.getMap<number>('accessVersion').get('access')).toBe(1);
    } finally {
      periodicServer.hocuspocus.documents.delete(documentName);
      await periodicServer.destroy();
      vi.useRealTimers();
    }
  });
});
