import { HocuspocusProvider } from '@hocuspocus/provider';
import { Document, type Server } from '@hocuspocus/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { CollabSession } from './collabSession';
import {
  createCollabServer,
  publishFolderDeletion,
  publishPageDeletion,
  publishPageRename,
} from './server';
import {
  createMockLogger as mockLogger,
  sleep,
  waitFor,
  waitForExactWorkspaceLockWaiter,
} from './serverTestHarness';
import { createTestPage, createTestUser, getTestPool } from './test-utils';

type MockConnectionOverrides = Partial<{
  messageAddress: string;
  send: ReturnType<typeof vi.fn>;
  sendStateless: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}>;

function createMockConnection(overrides: MockConnectionOverrides = {}) {
  return {
    messageAddress: 'test',
    send: vi.fn(),
    sendStateless: vi.fn(),
    close: vi.fn(),
    ...overrides,
  };
}

describe('collab server database event publication', () => {
  const pool = getTestPool();
  const logger = mockLogger();
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

  describe('database event publication', () => {
    it('suppresses delayed grant toasts after a permission update or revoke', async () => {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) throw new Error('DATABASE_URL is not set');
      const owner = await createTestUser(pool);
      const recipient = await createTestUser(pool);
      const updatedPage = await createTestPage(pool, owner.id, 'Updated before grant delivery');
      const revokedPage = await createTestPage(pool, owner.id, 'Revoked before grant delivery');
      for (const page of [updatedPage, revokedPage]) {
        await pool.query(
          `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
           values ('page', $1, $2, $3, 'edit')`,
          [page.id, owner.id, recipient.id],
        );
      }

      type GrantBarrier = {
        reached(): void;
        release: Promise<void>;
      };
      let grantBarrier: GrantBarrier | undefined;
      const gatedPool = new Proxy(pool, {
        get(target, property) {
          if (property === 'query') {
            return async (text: string, values?: unknown[]) => {
              if (text.includes("coalesce(sharer.name, 'Someone')") && grantBarrier) {
                const barrier = grantBarrier;
                barrier.reached();
                await barrier.release;
              }
              return target.query(text, values);
            };
          }
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const eventLogger = mockLogger();
      const eventDebug = eventLogger.debug as unknown as ReturnType<typeof vi.fn>;
      const eventInfo = eventLogger.info as unknown as ReturnType<typeof vi.fn>;
      const eventServer = createCollabServer({
        port: 0,
        internalSecret: 'test-collaboration-internal-secret',
        pool: gatedPool,
        logger: eventLogger,
        databaseUrl,
        permissionRevalidationMs: 0,
      });
      const connection = createMockConnection();
      const metaDocument = new Document(`page-meta:${recipient.id}`);
      vi.spyOn(metaDocument, 'getConnections').mockReturnValue([
        connection,
      ] as unknown as ReturnType<Document['getConnections']>);
      eventServer.hocuspocus.documents.set(`page-meta:${recipient.id}`, metaDocument);
      await eventServer.listen();

      const publishDelayedGrant = async (
        page: { id: string; title: string },
        mutate: () => Promise<unknown>,
      ): Promise<void> => {
        let markReached: (() => void) | undefined;
        let release: (() => void) | undefined;
        const reached = new Promise<void>((resolve) => {
          markReached = resolve;
        });
        const released = new Promise<void>((resolve) => {
          release = resolve;
        });
        grantBarrier = { reached: () => markReached?.(), release: released };
        await pool.query("select pg_notify('share_event', $1)", [
          JSON.stringify({
            type: 'grant_received',
            entityType: 'page',
            entityId: page.id,
            entityTitle: page.title,
            sharedByName: 'Test User',
            targetUserId: recipient.id,
            permission: 'edit',
            message: `Granted edit access to ${page.title}`,
          }),
        ]);
        await Promise.race([
          reached,
          sleep(5_000).then(() => {
            throw new Error('Timed out waiting for canonical grant validation');
          }),
        ]);
        await mutate();
        release?.();
        await waitFor(
          () =>
            eventDebug.mock.calls.some((call: unknown[]) =>
              String(call[0]).includes(`stale grant ignored for user=${recipient.id}`),
            ),
          5_000,
          'stale grant suppression',
        );
        grantBarrier = undefined;
      };

      try {
        await waitFor(
          () =>
            eventInfo.mock.calls.some((call: unknown[]) =>
              String(call[0]).includes('[listen] subscribed and reconciled'),
            ),
          10_000,
          'event listener subscription',
        );

        await publishDelayedGrant(updatedPage, () =>
          pool.query(
            `update shares set permission = 'view'
             where entity_type = 'page' and entity_id = $1 and recipient_user_id = $2`,
            [updatedPage.id, recipient.id],
          ),
        );
        eventDebug.mockClear();
        await publishDelayedGrant(revokedPage, () =>
          pool.query(
            `delete from shares
             where entity_type = 'page' and entity_id = $1 and recipient_user_id = $2`,
            [revokedPage.id, recipient.id],
          ),
        );

        expect(
          connection.sendStateless.mock.calls.some(([payload]) =>
            String(payload).includes('"type":"grant_received"'),
          ),
        ).toBe(false);
      } finally {
        grantBarrier = undefined;
        eventServer.hocuspocus.documents.delete(`page-meta:${recipient.id}`);
        await eventServer.destroy();
      }
    });

    it('updates the active document even when rename metadata publication fails', async () => {
      const pageId = crypto.randomUUID();
      const activeDocument = new Document(pageId);
      const metaRoomId = crypto.randomUUID();
      activeDocument.getText('title').insert(0, 'Old title');
      server.hocuspocus.documents.set(pageId, activeDocument);
      server.hocuspocus.documents.set(
        `page-meta:${metaRoomId}`,
        new Document(`page-meta:${metaRoomId}`),
      );
      const failingPool = {
        query: vi.fn(async () => {
          throw new Error('metadata unavailable');
        }),
      } as unknown as typeof pool;

      try {
        await expect(
          publishPageRename(server.hocuspocus, failingPool, pageId, 'New title', logger),
        ).rejects.toThrow('Failed to publish rename metadata');
        expect(activeDocument.getText('title').toString()).toBe('New title');
      } finally {
        server.hocuspocus.documents.delete(pageId);
        server.hocuspocus.documents.delete(`page-meta:${metaRoomId}`);
      }
    });

    it('publishes descendant page deletions from one folder event', async () => {
      const owner = await createTestUser(pool);
      const folderId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO folders (id, name, position, created_by, created_at, updated_at)
         VALUES ($1, 'Deleted folder', '0', $2, now(), now())`,
        [folderId, owner.id],
      );
      const page = await createTestPage(pool, owner.id);
      const deletedAt = new Date();
      await pool.query(
        'UPDATE pages SET parent_id = $1, is_deleted = true, deleted_at = $2 WHERE id = $3',
        [folderId, deletedAt, page.id],
      );
      await pool.query('UPDATE folders SET is_deleted = true, deleted_at = $1 WHERE id = $2', [
        new Date(deletedAt.getTime() + 1_000),
        folderId,
      ]);
      const connection = createMockConnection();
      const activeDocument = new Document(page.id);
      vi.spyOn(activeDocument, 'getConnections').mockReturnValue([
        connection,
      ] as unknown as ReturnType<Document['getConnections']>);
      server.hocuspocus.documents.set(page.id, activeDocument);

      try {
        await publishFolderDeletion(server.hocuspocus, pool, folderId, logger);
        expect(connection.close).toHaveBeenCalledWith({ code: 4402, reason: 'Page deleted' });
      } finally {
        server.hocuspocus.documents.delete(page.id);
      }
    });

    it('evicts an already-connected anonymous viewer after recursive folder deletion', async () => {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) throw new Error('DATABASE_URL is not set');
      const owner = await createTestUser(pool);
      const folderId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO folders (id, name, position, created_by, created_at, updated_at)
         VALUES ($1, 'Folder deleted with anonymous viewer', '0', $2, now(), now())`,
        [folderId, owner.id],
      );
      const page = await createTestPage(pool, owner.id, 'Public descendant');
      await pool.query(
        `UPDATE pages
         SET parent_id = $1, public_permission = 'view'
         WHERE id = $2`,
        [folderId, page.id],
      );

      const eventLogger = mockLogger();
      const eventServer = createCollabServer({
        port: 0,
        internalSecret: 'test-collaboration-internal-secret',
        pool,
        logger: eventLogger,
        databaseUrl,
        permissionRevalidationMs: 0,
      });
      await eventServer.listen();
      const eventPort = (eventServer as unknown as { address: { port: number } }).address.port;
      const statelessMessages: string[] = [];
      const closeEvents: Array<{ code: number; reason: string }> = [];
      const anonymousProvider = new HocuspocusProvider({
        url: `ws://localhost:${eventPort}`,
        name: page.id,
        document: new Y.Doc(),
        // Isolate LISTEN delivery from client-message access revalidation winning
        // the race immediately after the deletion transaction commits.
        awareness: null,
        token: `anon:${crypto.randomUUID()}`,
        onStateless: ({ payload }) => statelessMessages.push(payload),
        onClose: ({ event }) => closeEvents.push({ code: event.code, reason: event.reason }),
      });

      try {
        const listenerInfo = eventLogger.info as unknown as ReturnType<typeof vi.fn>;
        await waitFor(
          () =>
            listenerInfo.mock.calls.some((call: unknown[]) =>
              String(call[0]).includes('[listen] subscribed and reconciled'),
            ),
          5_000,
          'folder deletion listener subscription',
        );
        await waitFor(() => anonymousProvider.synced, 5_000, 'anonymous provider to sync');
        await waitFor(
          () =>
            (eventServer.hocuspocus.documents.get(page.id) as Document | undefined)
              ?.getConnections()
              .some((connection) => {
                const context = connection.context as CollabSession | undefined;
                return context?.principal.kind === 'anonymous';
              }) === true,
          5_000,
          'anonymous connection to become active',
        );

        const deletionClient = await pool.connect();
        try {
          await deletionClient.query('BEGIN');
          await deletionClient.query(
            `UPDATE pages
             SET is_deleted = true, deleted_at = statement_timestamp(), updated_at = now()
             WHERE id = $1`,
            [page.id],
          );
          await deletionClient.query(
            `UPDATE folders
             SET is_deleted = true, deleted_at = statement_timestamp(), updated_at = now()
             WHERE id = $1`,
            [folderId],
          );
          await deletionClient.query("SELECT pg_notify('folder_deleted', $1)", [
            JSON.stringify({ folderId }),
          ]);
          await deletionClient.query('COMMIT');
        } catch (error) {
          await deletionClient.query('ROLLBACK').catch(() => undefined);
          throw error;
        } finally {
          deletionClient.release();
        }

        const expectedDeletionMessage = JSON.stringify({
          type: 'entity_deleted',
          entityType: 'page',
          entityId: page.id,
        });
        await waitFor(
          () => statelessMessages.includes(expectedDeletionMessage),
          10_000,
          'anonymous viewer deletion notification',
        );
        await waitFor(
          () => closeEvents.some((event) => event.reason === 'Page deleted'),
          10_000,
          'anonymous viewer protocol close',
        );

        expect(closeEvents).toContainEqual({ code: 1000, reason: 'Page deleted' });
        expect(anonymousProvider.synced).toBe(false);
        await waitFor(
          () => {
            const activeDocument = eventServer.hocuspocus.documents.get(page.id) as
              | Document
              | undefined;
            return !activeDocument || activeDocument.getConnections().length === 0;
          },
          5_000,
          'anonymous connection to be removed from the active page',
        );
      } finally {
        anonymousProvider.destroy();
        await eventServer.destroy();
      }
    });

    it('notifies active metadata rooms when an empty folder is deleted', async () => {
      const owner = await createTestUser(pool);
      const folderId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO folders (id, name, position, created_by, created_at, updated_at)
         VALUES ($1, 'Empty folder', '0', $2, now(), now())`,
        [folderId, owner.id],
      );
      await pool.query('UPDATE folders SET is_deleted = true, deleted_at = now() WHERE id = $1', [
        folderId,
      ]);

      const connection = createMockConnection();
      const metaDocument = new Document(`page-meta:${owner.id}`);
      vi.spyOn(metaDocument, 'getConnections').mockReturnValue([
        connection,
      ] as unknown as ReturnType<Document['getConnections']>);
      server.hocuspocus.documents.set(`page-meta:${owner.id}`, metaDocument);

      try {
        await publishFolderDeletion(server.hocuspocus, pool, folderId, logger);
        expect(connection.sendStateless).toHaveBeenCalledWith(
          JSON.stringify({
            type: 'entity_deleted',
            entityType: 'folder',
            entityId: folderId,
          }),
        );
      } finally {
        server.hocuspocus.documents.delete(`page-meta:${owner.id}`);
      }
    });

    it('publishes a folder deletion without acquiring a nested pool lease', async () => {
      const owner = await createTestUser(pool);
      const folderId = crypto.randomUUID();
      await pool.query(
        `insert into folders (id, name, position, created_by, created_at, updated_at)
         values ($1, 'Single lease folder', '0', $2, now(), now())`,
        [folderId, owner.id],
      );
      await pool.query('update folders set is_deleted = true, deleted_at = now() where id = $1', [
        folderId,
      ]);

      const connection = createMockConnection();
      const metaDocument = new Document(`page-meta:${owner.id}`);
      vi.spyOn(metaDocument, 'getConnections').mockReturnValue([
        connection,
      ] as unknown as ReturnType<Document['getConnections']>);
      server.hocuspocus.documents.set(`page-meta:${owner.id}`, metaDocument);
      let connectCalls = 0;
      const singleLeasePool = new Proxy(pool, {
        get(target, property) {
          if (property === 'connect') {
            return async () => {
              connectCalls += 1;
              if (connectCalls > 1) throw new Error('nested pool lease requested');
              return target.connect();
            };
          }
          if (property === 'query') {
            return async () => {
              throw new Error('nested pool query requested');
            };
          }
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });

      try {
        await publishFolderDeletion(server.hocuspocus, singleLeasePool, folderId, logger);
        expect(connectCalls).toBe(1);
        expect(connection.sendStateless).toHaveBeenCalledWith(
          JSON.stringify({
            type: 'entity_deleted',
            entityType: 'folder',
            entityId: folderId,
          }),
        );
      } finally {
        server.hocuspocus.documents.delete(`page-meta:${owner.id}`);
      }
    });

    it('removes admin-created deleted pages from the workspace owner metadata', async () => {
      const owner = await createTestUser(pool);
      const admin = await createTestUser(pool);
      const folderId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO folders (id, name, position, created_by, created_at, updated_at)
         VALUES ($1, 'Owner folder', '0', $2, now(), now())`,
        [folderId, owner.id],
      );
      const page = await createTestPage(pool, admin.id);
      await pool.query('UPDATE pages SET parent_id = $1 WHERE id = $2', [folderId, page.id]);
      const deletedAt = new Date();
      await pool.query('UPDATE pages SET is_deleted = true, deleted_at = $1 WHERE id = $2', [
        deletedAt,
        page.id,
      ]);
      await pool.query('UPDATE folders SET is_deleted = true, deleted_at = $1 WHERE id = $2', [
        deletedAt,
        folderId,
      ]);

      const metaDocument = new Document(`page-meta:${owner.id}`);
      metaDocument.getMap('pageIndex').set(page.id, { title: page.title });
      server.hocuspocus.documents.set(`page-meta:${owner.id}`, metaDocument);

      try {
        await publishPageDeletion(server.hocuspocus, pool, page.id, logger);
        expect(metaDocument.getMap('pageIndex').has(page.id)).toBe(false);
      } finally {
        server.hocuspocus.documents.delete(`page-meta:${owner.id}`);
      }
    });

    it('ignores a delayed page deletion after the page is restored behind the workspace lock', async () => {
      const owner = await createTestUser(pool);
      const page = await createTestPage(pool, owner.id, 'Restored before publication');
      await pool.query(
        `update pages
         set is_deleted = true, deleted_at = now(), deletion_batch_id = gen_random_uuid()
         where id = $1`,
        [page.id],
      );

      const pageConnection = createMockConnection();
      const pageDocument = new Document(page.id);
      const metaDocument = new Document(`page-meta:${owner.id}`);
      metaDocument.getMap('pageIndex').set(page.id, { title: page.title });
      metaDocument.getMap('accessPermissions').set(page.id, 'admin');
      vi.spyOn(pageDocument, 'getConnections').mockReturnValue([
        pageConnection,
      ] as unknown as ReturnType<Document['getConnections']>);
      server.hocuspocus.documents.set(page.id, pageDocument);
      server.hocuspocus.documents.set(`page-meta:${owner.id}`, metaDocument);

      const blocker = await pool.connect();
      const blockerPid = (blocker as unknown as { processID: number }).processID;
      let transactionOpen = false;
      let publication: Promise<void> | undefined;
      try {
        await blocker.query('begin');
        transactionOpen = true;
        await blocker.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `workspace-access:${owner.id}`,
        ]);

        publication = publishPageDeletion(server.hocuspocus, pool, page.id, logger);
        await waitForExactWorkspaceLockWaiter(
          pool,
          blockerPid,
          'delayed page deletion publication to wait behind restore',
        );
        await blocker.query(
          `update pages
           set is_deleted = false, deleted_at = null, deletion_batch_id = null
           where id = $1`,
          [page.id],
        );
        await blocker.query('commit');
        transactionOpen = false;
        await publication;

        expect(pageConnection.sendStateless).not.toHaveBeenCalled();
        expect(pageConnection.close).not.toHaveBeenCalled();
        expect(metaDocument.getMap('pageIndex').has(page.id)).toBe(true);
        expect(metaDocument.getMap('accessPermissions').get(page.id)).toBe('admin');
      } finally {
        if (transactionOpen) await blocker.query('rollback').catch(() => undefined);
        blocker.release();
        await publication?.catch(() => undefined);
        server.hocuspocus.documents.delete(page.id);
        server.hocuspocus.documents.delete(`page-meta:${owner.id}`);
      }
    });

    it('ignores every delayed folder deletion side effect after the folder is restored', async () => {
      const owner = await createTestUser(pool);
      const folderId = crypto.randomUUID();
      await pool.query(
        `insert into folders (id, name, position, created_by, created_at, updated_at)
         values ($1, 'Restored folder', '0', $2, now(), now())`,
        [folderId, owner.id],
      );
      const page = await createTestPage(pool, owner.id, 'Restored descendant');
      const deletionBatchId = crypto.randomUUID();
      await pool.query(
        `update pages
         set parent_id = $1, is_deleted = true, deleted_at = now(), deletion_batch_id = $2
         where id = $3`,
        [folderId, deletionBatchId, page.id],
      );
      await pool.query(
        `update folders
         set is_deleted = true, deleted_at = now(), deletion_batch_id = $1
         where id = $2`,
        [deletionBatchId, folderId],
      );

      const pageConnection = createMockConnection();
      const metaConnection = createMockConnection();
      const pageDocument = new Document(page.id);
      const metaDocument = new Document(`page-meta:${owner.id}`);
      metaDocument.getMap('pageIndex').set(page.id, { title: page.title });
      vi.spyOn(pageDocument, 'getConnections').mockReturnValue([
        pageConnection,
      ] as unknown as ReturnType<Document['getConnections']>);
      vi.spyOn(metaDocument, 'getConnections').mockReturnValue([
        metaConnection,
      ] as unknown as ReturnType<Document['getConnections']>);
      server.hocuspocus.documents.set(page.id, pageDocument);
      server.hocuspocus.documents.set(`page-meta:${owner.id}`, metaDocument);

      const blocker = await pool.connect();
      const blockerPid = (blocker as unknown as { processID: number }).processID;
      let transactionOpen = false;
      let publication: Promise<void> | undefined;
      try {
        await blocker.query('begin');
        transactionOpen = true;
        await blocker.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `workspace-access:${owner.id}`,
        ]);

        publication = publishFolderDeletion(server.hocuspocus, pool, folderId, logger);
        await waitForExactWorkspaceLockWaiter(
          pool,
          blockerPid,
          'delayed folder deletion publication to wait behind restore',
        );
        await blocker.query(
          `update folders
           set is_deleted = false, deleted_at = null, deletion_batch_id = null
           where id = $1`,
          [folderId],
        );
        await blocker.query(
          `update pages
           set is_deleted = false, deleted_at = null, deletion_batch_id = null
           where id = $1`,
          [page.id],
        );
        await blocker.query('commit');
        transactionOpen = false;
        await publication;

        expect(pageConnection.sendStateless).not.toHaveBeenCalled();
        expect(pageConnection.close).not.toHaveBeenCalled();
        expect(metaConnection.sendStateless).not.toHaveBeenCalled();
        expect(metaDocument.getMap('pageIndex').has(page.id)).toBe(true);
      } finally {
        if (transactionOpen) await blocker.query('rollback').catch(() => undefined);
        blocker.release();
        await publication?.catch(() => undefined);
        server.hocuspocus.documents.delete(page.id);
        server.hocuspocus.documents.delete(`page-meta:${owner.id}`);
      }
    });

    it('excludes a descendant restored and moved before delayed folder publication', async () => {
      const owner = await createTestUser(pool);
      const folderId = crypto.randomUUID();
      await pool.query(
        `insert into folders (id, name, position, created_by, created_at, updated_at)
         values ($1, 'Still deleted folder', '0', $2, now(), now())`,
        [folderId, owner.id],
      );
      const page = await createTestPage(pool, owner.id, 'Moved restored descendant');
      const deletionBatchId = crypto.randomUUID();
      await pool.query(
        `update pages
         set parent_id = $1, is_deleted = true, deleted_at = now(), deletion_batch_id = $2
         where id = $3`,
        [folderId, deletionBatchId, page.id],
      );
      await pool.query(
        `update folders
         set is_deleted = true, deleted_at = now(), deletion_batch_id = $1
         where id = $2`,
        [deletionBatchId, folderId],
      );

      const pageConnection = createMockConnection();
      const metaConnection = createMockConnection();
      const pageDocument = new Document(page.id);
      const metaDocument = new Document(`page-meta:${owner.id}`);
      vi.spyOn(pageDocument, 'getConnections').mockReturnValue([
        pageConnection,
      ] as unknown as ReturnType<Document['getConnections']>);
      vi.spyOn(metaDocument, 'getConnections').mockReturnValue([
        metaConnection,
      ] as unknown as ReturnType<Document['getConnections']>);
      server.hocuspocus.documents.set(page.id, pageDocument);
      server.hocuspocus.documents.set(`page-meta:${owner.id}`, metaDocument);

      const blocker = await pool.connect();
      const blockerPid = (blocker as unknown as { processID: number }).processID;
      let transactionOpen = false;
      let publication: Promise<void> | undefined;
      try {
        await blocker.query('begin');
        transactionOpen = true;
        await blocker.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `workspace-access:${owner.id}`,
        ]);

        publication = publishFolderDeletion(server.hocuspocus, pool, folderId, logger);
        await waitForExactWorkspaceLockWaiter(
          pool,
          blockerPid,
          'delayed folder deletion publication to wait behind descendant restore',
        );
        await blocker.query(
          `update pages
           set parent_id = null, is_deleted = false, deleted_at = null, deletion_batch_id = null
           where id = $1`,
          [page.id],
        );
        await blocker.query('commit');
        transactionOpen = false;
        await publication;

        expect(pageConnection.sendStateless).not.toHaveBeenCalled();
        expect(pageConnection.close).not.toHaveBeenCalled();
        expect(metaDocument.getMap('pageIndex').has(page.id)).toBe(true);
        expect(metaConnection.sendStateless).toHaveBeenCalledWith(
          JSON.stringify({
            type: 'entity_deleted',
            entityType: 'folder',
            entityId: folderId,
          }),
        );
      } finally {
        if (transactionOpen) await blocker.query('rollback').catch(() => undefined);
        blocker.release();
        await publication?.catch(() => undefined);
        server.hocuspocus.documents.delete(page.id);
        server.hocuspocus.documents.delete(`page-meta:${owner.id}`);
      }
    });

    it('publishes a purged page deletion to every stale active metadata index', async () => {
      const pageId = crypto.randomUUID();
      const firstUserId = crypto.randomUUID();
      const secondUserId = crypto.randomUUID();
      const unrelatedUserId = crypto.randomUUID();
      const pageConnection = createMockConnection();
      const pageDocument = new Document(pageId);
      vi.spyOn(pageDocument, 'getConnections').mockReturnValue([
        pageConnection,
      ] as unknown as ReturnType<Document['getConnections']>);
      server.hocuspocus.documents.set(pageId, pageDocument);

      const metaDocuments = [firstUserId, secondUserId].map((userId) => {
        const document = new Document(`page-meta:${userId}`);
        document.getMap('pageIndex').set(pageId, { title: 'Purged page' });
        document.getMap('accessPermissions').set(pageId, 'view');
        server.hocuspocus.documents.set(`page-meta:${userId}`, document);
        return document;
      });
      const unrelatedDocument = new Document(`page-meta:${unrelatedUserId}`);
      unrelatedDocument.getMap('pageIndex').set(crypto.randomUUID(), { title: 'Unrelated page' });
      server.hocuspocus.documents.set(`page-meta:${unrelatedUserId}`, unrelatedDocument);

      try {
        await publishPageDeletion(server.hocuspocus, pool, pageId, logger);

        expect(pageConnection.close).toHaveBeenCalledWith({ code: 4402, reason: 'Page deleted' });
        for (const document of metaDocuments) {
          expect(document.getMap('pageIndex').has(pageId)).toBe(false);
          expect(document.getMap('accessPermissions').has(pageId)).toBe(false);
        }
        expect(unrelatedDocument.getMap('pageIndex').has(pageId)).toBe(false);
        expect(unrelatedDocument.getMap('accessPermissions').has(pageId)).toBe(false);
        expect(unrelatedDocument.getMap('backlinksVersion').has(pageId)).toBe(false);
      } finally {
        server.hocuspocus.documents.delete(pageId);
        server.hocuspocus.documents.delete(`page-meta:${firstUserId}`);
        server.hocuspocus.documents.delete(`page-meta:${secondUserId}`);
        server.hocuspocus.documents.delete(`page-meta:${unrelatedUserId}`);
      }
    });

    it('reconciles purged folder descendants without broadcasting a purged folder ID', async () => {
      const folderId = crypto.randomUUID();
      const pageId = crypto.randomUUID();
      const userId = crypto.randomUUID();
      const pageConnection = createMockConnection();
      const metaConnection = createMockConnection();
      const pageDocument = new Document(pageId);
      const metaDocument = new Document(`page-meta:${userId}`);
      metaDocument.getMap('pageIndex').set(pageId, { title: 'Purged descendant' });
      metaDocument.getMap('accessPermissions').set(pageId, 'view');
      vi.spyOn(pageDocument, 'getConnections').mockReturnValue([
        pageConnection,
      ] as unknown as ReturnType<Document['getConnections']>);
      vi.spyOn(metaDocument, 'getConnections').mockReturnValue([
        metaConnection,
      ] as unknown as ReturnType<Document['getConnections']>);
      server.hocuspocus.documents.set(pageId, pageDocument);
      server.hocuspocus.documents.set(`page-meta:${userId}`, metaDocument);

      try {
        await publishFolderDeletion(server.hocuspocus, pool, folderId, logger);

        expect(pageConnection.close).toHaveBeenCalledWith({ code: 4402, reason: 'Page deleted' });
        expect(metaDocument.getMap('pageIndex').has(pageId)).toBe(false);
        expect(metaDocument.getMap('accessPermissions').has(pageId)).toBe(false);
        expect(metaConnection.sendStateless).not.toHaveBeenCalled();
      } finally {
        server.hocuspocus.documents.delete(pageId);
        server.hocuspocus.documents.delete(`page-meta:${userId}`);
      }
    });

    it('closes active page connections when canonical deletion metadata lookup fails', async () => {
      const owner = await createTestUser(pool);
      const page = await createTestPage(pool, owner.id, 'Deleted before metadata failure');
      await pool.query('update pages set is_deleted = true, deleted_at = now() where id = $1', [
        page.id,
      ]);
      const connection = createMockConnection();
      const activeDocument = new Document(page.id);
      vi.spyOn(activeDocument, 'getConnections').mockReturnValue([
        connection,
      ] as unknown as ReturnType<Document['getConnections']>);
      server.hocuspocus.documents.set(page.id, activeDocument);
      server.hocuspocus.documents.set(
        `page-meta:${owner.id}`,
        new Document(`page-meta:${owner.id}`),
      );
      const failingPool = new Proxy(pool, {
        get(target, property) {
          if (property === 'connect') {
            return async () => {
              const client = await target.connect();
              return new Proxy(client, {
                get(clientTarget, clientProperty) {
                  if (clientProperty === 'query') {
                    return async (text: string, values?: unknown[]) => {
                      if (text.includes('with page_info as')) {
                        expect(connection.close).not.toHaveBeenCalled();
                        throw new Error('metadata unavailable');
                      }
                      return clientTarget.query(text, values);
                    };
                  }
                  const value: unknown = Reflect.get(clientTarget, clientProperty, clientTarget);
                  return typeof value === 'function' ? value.bind(clientTarget) : value;
                },
              });
            };
          }
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });

      try {
        await expect(
          publishPageDeletion(server.hocuspocus, failingPool, page.id, logger),
        ).rejects.toThrow('metadata unavailable');
        expect(connection.close).toHaveBeenCalledWith({ code: 4402, reason: 'Page deleted' });
        expect(connection.sendStateless).toHaveBeenCalledWith(
          expect.stringContaining('"type":"entity_deleted"'),
        );
      } finally {
        server.hocuspocus.documents.delete(page.id);
        server.hocuspocus.documents.delete(`page-meta:${owner.id}`);
      }
    });
  });
});
