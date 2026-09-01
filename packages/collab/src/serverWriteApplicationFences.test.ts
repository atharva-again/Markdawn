import type { Server } from '@hocuspocus/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { revalidateActivePageConnections } from './permission-handler';
import {
  createCollabServer,
  publishPageDeletion,
  reconcileActiveCollaborationState,
} from './server';
import {
  applicationsInFlight,
  createPausedConnectionHarness,
  encodeYjsUpdateMessage,
  createMockLogger as mockLogger,
  sleep,
  waitFor,
} from './serverTestHarness';
import { createTestPage, createTestSession, createTestUser, getTestPool } from './test-utils';

describe('collab server write application fences', () => {
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

  describe('held write application fences', () => {
    it('persists an exact admitted update when revoke closes the real connection before apply', async () => {
      const owner = await createTestUser(pool);
      const editor = await createTestUser(pool);
      const page = await createTestPage(pool, owner.id);
      await pool.query(
        `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         values ('page', $1, $2, $3, 'edit')`,
        [page.id, owner.id, editor.id],
      );
      const session = await createTestSession(pool, editor.id);
      const harness = await createPausedConnectionHarness(server, page.id, session.token);
      const clientDocument = new Y.Doc();
      clientDocument.getText('content').insert(0, 'admitted before revoke teardown');
      const update = Y.encodeStateAsUpdate(clientDocument);

      harness.connection.handleMessage(encodeYjsUpdateMessage(page.id, update));
      await Promise.race([
        harness.hookResolved,
        sleep(5_000).then(() => {
          throw new Error('Timed out waiting for held write admission');
        }),
      ]);

      await pool.query(
        `delete from shares
         where entity_type = 'page' and entity_id = $1 and recipient_user_id = $2`,
        [page.id, editor.id],
      );
      await revalidateActivePageConnections(server, pool, logger);
      expect(harness.context.permission).toBeNull();
      expect(harness.document.hasConnection(harness.connection)).toBe(true);
      expect(harness.document.isDestroyed).toBe(false);

      harness.releaseApply();
      await Promise.race([
        harness.teardown,
        sleep(5_000).then(() => {
          throw new Error('Timed out waiting for deferred revoke teardown');
        }),
      ]);

      expect(harness.document.isDestroyed).toBe(true);
      expect(server.hocuspocus.documents.has(page.id)).toBe(false);
      const stored = await pool.query<{ ydoc: Buffer | null }>(
        'select ydoc from pages where id = $1',
        [page.id],
      );
      expect(stored.rows[0]?.ydoc).not.toBeNull();
      const storedDocument = new Y.Doc();
      Y.applyUpdate(storedDocument, new Uint8Array(stored.rows[0]?.ydoc ?? []));
      expect(storedDocument.getText('content').toString()).toBe('admitted before revoke teardown');
    });

    it('keeps Trash blocked through physical apply and persists before real close/unload', async () => {
      const owner = await createTestUser(pool);
      const page = await createTestPage(pool, owner.id);
      const session = await createTestSession(pool, owner.id);
      const harness = await createPausedConnectionHarness(server, page.id, session.token);
      const clientDocument = new Y.Doc();
      clientDocument.getText('content').insert(0, 'applied before Trash teardown');
      const update = Y.encodeStateAsUpdate(clientDocument);
      const trashClient = await pool.connect();
      let trashCommitted = false;

      try {
        harness.connection.handleMessage(encodeYjsUpdateMessage(page.id, update));
        await Promise.race([
          harness.hookResolved,
          sleep(5_000).then(() => {
            throw new Error('Timed out waiting for held write admission');
          }),
        ]);

        const trashPromise = trashClient
          .query(
            `update pages
             set is_deleted = true, deleted_at = now(), updated_at = now()
             where id = $1`,
            [page.id],
          )
          .then(() => {
            trashCommitted = true;
          });
        const trashPid = (trashClient as unknown as { processID: number }).processID;
        await waitFor(
          async () => {
            const result = await pool.query<{ waiting: boolean }>(
              `select exists (
                 select 1 from pg_stat_activity
                 where pid = $1 and wait_event_type = 'Lock'
               ) as waiting`,
              [trashPid],
            );
            return result.rows[0]?.waiting === true;
          },
          5_000,
          'Trash update to wait behind the application fence',
        );
        expect(trashCommitted).toBe(false);

        harness.releaseApply();
        await trashPromise;
        expect(harness.document.getText('content').toString()).toBe(
          'applied before Trash teardown',
        );
        await publishPageDeletion(server.hocuspocus, pool, page.id, logger);
        await Promise.race([
          harness.teardown,
          sleep(5_000).then(() => {
            throw new Error('Timed out waiting for Trash teardown');
          }),
        ]);

        expect(harness.document.isDestroyed).toBe(true);
        expect(server.hocuspocus.documents.has(page.id)).toBe(false);
        const stored = await pool.query<{ is_deleted: boolean; ydoc: Buffer | null }>(
          'select is_deleted, ydoc from pages where id = $1',
          [page.id],
        );
        expect(stored.rows[0]?.is_deleted).toBe(true);
        const storedDocument = new Y.Doc();
        Y.applyUpdate(storedDocument, new Uint8Array(stored.rows[0]?.ydoc ?? []));
        expect(storedDocument.getText('content').toString()).toBe('applied before Trash teardown');
      } finally {
        harness.releaseApply();
        trashClient.release();
      }
    });

    it('linearizes an API rename queued after admission after the physical title apply', async () => {
      const owner = await createTestUser(pool);
      const page = await createTestPage(pool, owner.id, 'Initial title');
      const session = await createTestSession(pool, owner.id);
      const harness = await createPausedConnectionHarness(server, page.id, session.token);
      const clientDocument = new Y.Doc();
      clientDocument.getText('title').insert(0, 'Collaborative title');
      const titleUpdate = Y.encodeStateAsUpdate(clientDocument);
      const apiClient = await pool.connect();
      let apiRenameCommitted = false;

      try {
        harness.connection.handleMessage(encodeYjsUpdateMessage(page.id, titleUpdate));
        await Promise.race([
          harness.hookResolved,
          sleep(5_000).then(() => {
            throw new Error('Timed out waiting for held title admission');
          }),
        ]);
        const apiRename = apiClient
          .query(
            `update pages
             set title = 'API title after admission',
                 title_revision = title_revision + 1,
                 updated_at = now()
             where id = $1`,
            [page.id],
          )
          .then(() => {
            apiRenameCommitted = true;
          });
        const apiPid = (apiClient as unknown as { processID: number }).processID;
        await waitFor(
          async () => {
            const result = await pool.query<{ waiting: boolean }>(
              `select exists (
                 select 1 from pg_stat_activity
                 where pid = $1 and wait_event_type = 'Lock'
               ) as waiting`,
              [apiPid],
            );
            return result.rows[0]?.waiting === true;
          },
          5_000,
          'API rename to wait behind the title application fence',
        );
        expect(apiRenameCommitted).toBe(false);

        harness.releaseApply();
        await apiRename;
        await reconcileActiveCollaborationState(server, pool, logger);
        expect(harness.document.getText('title').toString()).toBe('API title after admission');

        await server.hocuspocus.hooks('onStoreDocument', {
          clientsCount: 1,
          lastContext: harness.context,
          lastTransactionOrigin: null,
          document: harness.document,
          documentName: page.id,
          instance: server.hocuspocus,
        });
        const stored = await pool.query<{
          title: string;
          title_revision: string;
          ydoc: Buffer | null;
        }>('select title, title_revision::text as title_revision, ydoc from pages where id = $1', [
          page.id,
        ]);
        expect(stored.rows[0]?.title).toBe('API title after admission');
        expect(BigInt(stored.rows[0]?.title_revision ?? '0')).toBeGreaterThanOrEqual(1n);
        const storedDocument = new Y.Doc();
        Y.applyUpdate(storedDocument, new Uint8Array(stored.rows[0]?.ydoc ?? []));
        expect(storedDocument.getText('title').toString()).toBe('API title after admission');

        harness.connection.close();
        await harness.teardown;
      } finally {
        harness.releaseApply();
        apiClient.release();
      }
    });

    it('lets a collaborative title admitted after an API rename win before delayed listener delivery', async () => {
      const owner = await createTestUser(pool);
      const page = await createTestPage(pool, owner.id, 'Initial title');
      const session = await createTestSession(pool, owner.id);
      const harness = await createPausedConnectionHarness(server, page.id, session.token);
      await pool.query(
        `update pages
         set title = 'API title first', title_revision = title_revision + 1, updated_at = now()
         where id = $1`,
        [page.id],
      );
      const clientDocument = new Y.Doc();
      clientDocument.getText('title').insert(0, 'Collaborative title after API');

      try {
        harness.connection.handleMessage(
          encodeYjsUpdateMessage(page.id, Y.encodeStateAsUpdate(clientDocument)),
        );
        await harness.hookResolved;
        harness.releaseApply();
        await waitFor(
          () => harness.document.getText('title').toString() === 'Collaborative title after API',
          5_000,
          'collaborative title to physically apply',
        );

        // Store before the delayed page_renamed listener. The admission's
        // title-only revision proves this collaboration write is later.
        await server.hocuspocus.hooks('onStoreDocument', {
          clientsCount: 1,
          lastContext: harness.context,
          lastTransactionOrigin: null,
          document: harness.document,
          documentName: page.id,
          instance: server.hocuspocus,
        });
        await reconcileActiveCollaborationState(server, pool, logger);

        const stored = await pool.query<{ title: string; title_revision: string }>(
          'select title, title_revision::text as title_revision from pages where id = $1',
          [page.id],
        );
        expect(stored.rows[0]?.title).toBe('Collaborative title after API');
        expect(BigInt(stored.rows[0]?.title_revision ?? '0')).toBe(2n);
        expect(harness.document.getText('title').toString()).toBe('Collaborative title after API');

        harness.connection.close();
        await harness.teardown;
      } finally {
        harness.releaseApply();
      }
    });

    it('does not let a content-only admission mask an earlier API rename', async () => {
      const owner = await createTestUser(pool);
      const page = await createTestPage(pool, owner.id, 'Initial title');
      const session = await createTestSession(pool, owner.id);
      const harness = await createPausedConnectionHarness(server, page.id, session.token);
      await pool.query(
        `update pages
         set title = 'API title before content', title_revision = title_revision + 1,
             updated_at = now()
         where id = $1`,
        [page.id],
      );
      const clientDocument = new Y.Doc();
      clientDocument.getText('content').insert(0, 'content-only change');

      try {
        harness.connection.handleMessage(
          encodeYjsUpdateMessage(page.id, Y.encodeStateAsUpdate(clientDocument)),
        );
        await harness.hookResolved;
        harness.releaseApply();
        await waitFor(
          () => harness.document.getText('content').toString() === 'content-only change',
          5_000,
          'content-only update to physically apply',
        );
        await server.hocuspocus.hooks('onStoreDocument', {
          clientsCount: 1,
          lastContext: harness.context,
          lastTransactionOrigin: null,
          document: harness.document,
          documentName: page.id,
          instance: server.hocuspocus,
        });

        const stored = await pool.query<{
          title: string;
          title_revision: string;
          ydoc: Buffer | null;
        }>('select title, title_revision::text as title_revision, ydoc from pages where id = $1', [
          page.id,
        ]);
        expect(stored.rows[0]?.title).toBe('API title before content');
        expect(BigInt(stored.rows[0]?.title_revision ?? '0')).toBe(1n);
        const storedDocument = new Y.Doc();
        Y.applyUpdate(storedDocument, new Uint8Array(stored.rows[0]?.ydoc ?? []));
        expect(storedDocument.getText('title').toString()).toBe('API title before content');
        expect(storedDocument.getText('content').toString()).toBe('content-only change');

        harness.connection.close();
        await harness.teardown;
      } finally {
        harness.releaseApply();
      }
    });

    it('finalizes a duplicate no-op update that emits no onChange event', async () => {
      const owner = await createTestUser(pool);
      const page = await createTestPage(pool, owner.id);
      const session = await createTestSession(pool, owner.id);
      const harness = await createPausedConnectionHarness(server, page.id, session.token);
      const clientDocument = new Y.Doc();
      clientDocument.getText('content').insert(0, 'one effective update');
      const updateMessage = encodeYjsUpdateMessage(page.id, Y.encodeStateAsUpdate(clientDocument));

      try {
        harness.connection.handleMessage(updateMessage);
        await harness.hookResolved;
        harness.releaseApply();
        await waitFor(
          () => harness.document.getText('content').toString() === 'one effective update',
          5_000,
          'first update to apply',
        );
        await waitFor(
          () => applicationsInFlight(harness.context) === 0,
          5_000,
          'first application transaction to finalize',
        );

        harness.connection.handleMessage(updateMessage);
        await waitFor(
          () => harness.admissionsResolved() >= 2,
          5_000,
          'duplicate update permission hook to resolve',
        );
        await waitFor(
          () => applicationsInFlight(harness.context) === 0,
          5_000,
          'duplicate no-op transaction to finalize',
        );
        await Promise.race([
          pool.query(
            `update pages
             set title = 'lock released after duplicate', title_revision = title_revision + 1
             where id = $1`,
            [page.id],
          ),
          sleep(2_000).then(() => {
            throw new Error('Duplicate update leaked its application lock');
          }),
        ]);

        harness.connection.close();
        await harness.teardown;
        const stored = await pool.query<{ ydoc: Buffer | null }>(
          'select ydoc from pages where id = $1',
          [page.id],
        );
        const storedDocument = new Y.Doc();
        Y.applyUpdate(storedDocument, new Uint8Array(stored.rows[0]?.ydoc ?? []));
        expect(storedDocument.getText('content').toString()).toBe('one effective update');
      } finally {
        harness.releaseApply();
      }
    });

    it('finalizes and releases the held transaction when malformed Yjs emits no onChange', async () => {
      const owner = await createTestUser(pool);
      const page = await createTestPage(pool, owner.id);
      const session = await createTestSession(pool, owner.id);
      const harness = await createPausedConnectionHarness(server, page.id, session.token);

      harness.connection.handleMessage(
        encodeYjsUpdateMessage(page.id, Uint8Array.of(0xff, 0xfe, 0xfd)),
      );
      await harness.hookResolved;
      harness.releaseApply();
      await waitFor(
        () => applicationsInFlight(harness.context) === 0,
        5_000,
        'malformed application transaction to finalize',
      );

      await Promise.race([
        pool.query(
          `update pages
           set title = 'lock released after malformed', title_revision = title_revision + 1
           where id = $1`,
          [page.id],
        ),
        sleep(2_000).then(() => {
          throw new Error('Malformed update leaked its application lock');
        }),
      ]);
      expect(harness.document.getText('content').toString()).toBe('');
      harness.connection.close();
      await harness.teardown;
      const stored = await pool.query<{ ydoc: Buffer | null }>(
        'select ydoc from pages where id = $1',
        [page.id],
      );
      expect(stored.rows[0]?.ydoc).toBeNull();
      expect(harness.document.isDestroyed).toBe(true);
    });

    it('rolls back a timed-out application fence and rejects the late physical apply', async () => {
      const timeoutServer = createCollabServer({
        port: 0,
        internalSecret: 'test-collaboration-internal-secret',
        pool,
        logger: mockLogger(),
        permissionRevalidationMs: 0,
        applicationFenceTimeoutMs: 50,
      });
      const owner = await createTestUser(pool);
      const page = await createTestPage(pool, owner.id);
      const session = await createTestSession(pool, owner.id);
      const harness = await createPausedConnectionHarness(timeoutServer, page.id, session.token);
      const clientDocument = new Y.Doc();
      clientDocument.getText('content').insert(0, 'must not apply after timeout');

      try {
        harness.connection.handleMessage(
          encodeYjsUpdateMessage(page.id, Y.encodeStateAsUpdate(clientDocument)),
        );
        await harness.hookResolved;
        await Promise.race([
          harness.teardown,
          sleep(5_000).then(() => {
            throw new Error('Timed-out application fence did not close and unload');
          }),
        ]);
        await Promise.race([
          pool.query(
            `update pages
             set title = 'lock released after timeout', title_revision = title_revision + 1
             where id = $1`,
            [page.id],
          ),
          sleep(2_000).then(() => {
            throw new Error('Timed-out application fence leaked its database lock');
          }),
        ]);

        harness.releaseApply();
        await sleep(50);
        expect(harness.document.getText('content').toString()).toBe('');
        const stored = await pool.query<{ ydoc: Buffer | null }>(
          'select ydoc from pages where id = $1',
          [page.id],
        );
        expect(stored.rows[0]?.ydoc).toBeNull();
      } finally {
        harness.releaseApply();
        await timeoutServer.destroy();
      }
    });
  });
});
