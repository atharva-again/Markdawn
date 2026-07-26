import { HocuspocusProvider } from '@hocuspocus/provider';
import { type beforeHandleMessagePayload, Document, type Server } from '@hocuspocus/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createCollabServer } from './server';
import {
  createAuthenticatePayload,
  createConnectionConfig,
  encodeYjsUpdateMessage,
  createMockLogger as mockLogger,
  sleep,
  waitFor,
  waitForExactWorkspaceLockWaiter,
  waitUntilAfter,
} from './serverTestHarness';
import { createTestPage, createTestSession, createTestUser, getTestPool } from './test-utils';

describe('collab server write authorization fencing', () => {
  const pool = getTestPool();
  const logger = mockLogger();
  let server: Server;
  let port: number;
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
    port = (server as unknown as { address: { port: number } }).address.port;
  });
  afterAll(async () => {
    await server.destroy();
    await pool.end();
  });

  describe('write authorization fencing', () => {
    it('rejects a write when an account grant is revoked behind the workspace lock', async () => {
      const owner = await createTestUser(pool);
      const editor = await createTestUser(pool);
      const page = await createTestPage(pool, owner.id);
      const editorSession = await createTestSession(pool, editor.id);
      await pool.query(
        `insert into shares (
           entity_type, entity_id, shared_by, recipient_user_id, permission
         ) values (
           'page', $1, $2, $3, 'edit'
         )`,
        [page.id, owner.id, editor.id],
      );

      const context = await server.hocuspocus.hooks(
        'onAuthenticate',
        createAuthenticatePayload(server, {
          documentName: page.id,
          token: editorSession.token,
        }),
      );
      const blocker = await pool.connect();
      const blockerPid = (blocker as unknown as { processID: number }).processID;
      const connection = {
        context,
        readOnly: false,
        send: vi.fn(),
        sendStateless: vi.fn(),
        close: vi.fn(),
      } as unknown as beforeHandleMessagePayload['connection'];
      const source = new Y.Doc();
      source.getText('content').insert(0, 'must expire behind the lock');
      const update = encodeYjsUpdateMessage(page.id, Y.encodeStateAsUpdate(source));
      const document = new Document(page.id);
      let lockReleased = false;

      try {
        await blocker.query('select pg_advisory_lock(hashtextextended($1, 0))', [
          `workspace-access:${owner.id}`,
        ]);
        const admission = server.hocuspocus
          .hooks('beforeHandleMessage', {
            clientsCount: 1,
            context,
            document,
            documentName: page.id,
            instance: server.hocuspocus,
            requestHeaders: {},
            requestParameters: new URLSearchParams(),
            socketId: crypto.randomUUID(),
            update,
            connection,
          })
          .then(
            () => ({ status: 'fulfilled' as const }),
            (error: unknown) => ({ status: 'rejected' as const, error }),
          );

        await waitForExactWorkspaceLockWaiter(
          pool,
          blockerPid,
          'write admission to wait on the workspace lock',
        );
        await blocker.query(
          `delete from shares
           where entity_type = 'page' and entity_id = $1 and recipient_user_id = $2`,
          [page.id, editor.id],
        );
        await blocker.query('select pg_advisory_unlock(hashtextextended($1, 0))', [
          `workspace-access:${owner.id}`,
        ]);
        lockReleased = true;

        const outcome = await admission;
        expect(outcome.status).toBe('rejected');
        if (outcome.status === 'rejected') {
          expect(outcome.error).toBeInstanceOf(Error);
          expect((outcome.error as Error).message).toBe('Forbidden');
        }
        expect(connection.close).toHaveBeenCalledWith({
          code: 4401,
          reason: 'Access revoked',
        });
        expect(document.getText('content').toString()).toBe('');
      } finally {
        if (!lockReleased) {
          await blocker
            .query('select pg_advisory_unlock(hashtextextended($1, 0))', [
              `workspace-access:${owner.id}`,
            ])
            .catch(() => undefined);
        }
        blocker.release();
      }
    });

    it('rejects a write when the workspace lock wait crosses session expiry', async () => {
      const owner = await createTestUser(pool);
      const page = await createTestPage(pool, owner.id);
      const session = await createTestSession(pool, owner.id);
      const context = await server.hocuspocus.hooks(
        'onAuthenticate',
        createAuthenticatePayload(server, {
          documentName: page.id,
          token: session.token,
        }),
      );
      const expiry = await pool.query<{ expires_at: Date }>(
        `update sessions
         set expires_at = clock_timestamp() + interval '3 seconds'
         where token = $1
         returning expires_at`,
        [session.token],
      );
      const expiresAt = expiry.rows[0]?.expires_at;
      if (!expiresAt) throw new Error('Expected expiring session');
      const blocker = await pool.connect();
      const blockerPid = (blocker as unknown as { processID: number }).processID;
      const connection = {
        context,
        readOnly: false,
        send: vi.fn(),
        sendStateless: vi.fn(),
        close: vi.fn(),
      } as unknown as beforeHandleMessagePayload['connection'];
      const source = new Y.Doc();
      source.getText('content').insert(0, 'must not outlive the session');
      const update = encodeYjsUpdateMessage(page.id, Y.encodeStateAsUpdate(source));
      const document = new Document(page.id);
      let lockReleased = false;

      try {
        await blocker.query('select pg_advisory_lock(hashtextextended($1, 0))', [
          `workspace-access:${owner.id}`,
        ]);
        const admission = server.hocuspocus
          .hooks('beforeHandleMessage', {
            clientsCount: 1,
            context,
            document,
            documentName: page.id,
            instance: server.hocuspocus,
            requestHeaders: {},
            requestParameters: new URLSearchParams(),
            socketId: crypto.randomUUID(),
            update,
            connection,
          })
          .then(
            () => ({ status: 'fulfilled' as const }),
            (error: unknown) => ({ status: 'rejected' as const, error }),
          );

        const transactionStartedAt = await waitForExactWorkspaceLockWaiter(
          pool,
          blockerPid,
          'session-expiry write admission to wait on the exact workspace lock',
        );
        expect(transactionStartedAt.getTime()).toBeLessThan(expiresAt.getTime());
        expect(expiresAt.getTime() - transactionStartedAt.getTime()).toBeGreaterThan(1_000);
        const observedAfterExpiry = await waitUntilAfter(pool, expiresAt);
        expect(observedAfterExpiry.getTime()).toBeGreaterThan(expiresAt.getTime());
        await blocker.query('select pg_advisory_unlock(hashtextextended($1, 0))', [
          `workspace-access:${owner.id}`,
        ]);
        lockReleased = true;

        const outcome = await admission;
        expect(outcome.status).toBe('rejected');
        if (outcome.status === 'rejected') {
          expect(outcome.error).toBeInstanceOf(Error);
          expect((outcome.error as Error).message).toBe('Forbidden');
        }
        expect(connection.close).toHaveBeenCalledWith({
          code: 4401,
          reason: 'Access revoked',
        });
        expect(document.getText('content').toString()).toBe('');
      } finally {
        if (!lockReleased) {
          await blocker
            .query('select pg_advisory_unlock(hashtextextended($1, 0))', [
              `workspace-access:${owner.id}`,
            ])
            .catch(() => undefined);
        }
        blocker.release();
      }
    });

    it('rejects an anonymous write when public access is revoked behind the workspace lock', async () => {
      const owner = await createTestUser(pool);
      const page = await createTestPage(pool, owner.id);
      await pool.query("update pages set public_permission = 'edit' where id = $1", [page.id]);
      const anonymousId = crypto.randomUUID();
      const context = await server.hocuspocus.hooks(
        'onAuthenticate',
        createAuthenticatePayload(server, {
          documentName: page.id,
          token: `anon:${anonymousId}`,
        }),
      );
      expect((context as { permission?: unknown }).permission).toBe('edit');
      const blocker = await pool.connect();
      const blockerPid = (blocker as unknown as { processID: number }).processID;
      const connection = {
        context,
        readOnly: false,
        send: vi.fn(),
        sendStateless: vi.fn(),
        close: vi.fn(),
      } as unknown as beforeHandleMessagePayload['connection'];
      const source = new Y.Doc();
      source.getText('content').insert(0, 'must not outlive public access');
      const update = encodeYjsUpdateMessage(page.id, Y.encodeStateAsUpdate(source));
      const document = new Document(page.id);
      let lockReleased = false;

      try {
        await blocker.query('select pg_advisory_lock(hashtextextended($1, 0))', [
          `workspace-access:${owner.id}`,
        ]);
        const admission = server.hocuspocus
          .hooks('beforeHandleMessage', {
            clientsCount: 1,
            context,
            document,
            documentName: page.id,
            instance: server.hocuspocus,
            requestHeaders: {},
            requestParameters: new URLSearchParams(),
            socketId: crypto.randomUUID(),
            update,
            connection,
          })
          .then(
            () => ({ status: 'fulfilled' as const }),
            (error: unknown) => ({ status: 'rejected' as const, error }),
          );

        await waitForExactWorkspaceLockWaiter(
          pool,
          blockerPid,
          'public-access write admission to wait on the exact workspace lock',
        );
        await blocker.query('update pages set public_permission = null where id = $1', [page.id]);
        await blocker.query('select pg_advisory_unlock(hashtextextended($1, 0))', [
          `workspace-access:${owner.id}`,
        ]);
        lockReleased = true;

        const outcome = await admission;
        expect(outcome.status).toBe('rejected');
        if (outcome.status === 'rejected') {
          expect(outcome.error).toBeInstanceOf(Error);
          expect((outcome.error as Error).message).toBe('Forbidden');
        }
        expect(connection.close).toHaveBeenCalledWith({
          code: 4401,
          reason: 'Access revoked',
        });
        expect(document.getText('content').toString()).toBe('');
      } finally {
        if (!lockReleased) {
          await blocker
            .query('select pg_advisory_unlock(hashtextextended($1, 0))', [
              `workspace-access:${owner.id}`,
            ])
            .catch(() => undefined);
        }
        blocker.release();
      }
    });

    it('rejects a real view-only provider update without leaking it to an owner', async () => {
      const owner = await createTestUser(pool);
      const viewer = await createTestUser(pool);
      const page = await createTestPage(pool, owner.id);
      await pool.query(
        `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         values ('page', $1, $2, $3, 'view')`,
        [page.id, owner.id, viewer.id],
      );
      const viewerSession = await createTestSession(pool, viewer.id);
      const ownerSession = await createTestSession(pool, owner.id);
      const viewerDocument = new Y.Doc();
      const viewerProvider = new HocuspocusProvider({
        url: `ws://localhost:${port}`,
        name: page.id,
        document: viewerDocument,
        token: viewerSession.token,
      });
      const ownerDocument = new Y.Doc();
      const ownerProvider = new HocuspocusProvider({
        url: `ws://localhost:${port}`,
        name: page.id,
        document: ownerDocument,
        token: ownerSession.token,
      });

      try {
        await waitFor(
          () => viewerProvider.synced && ownerProvider.synced,
          5_000,
          'view-only and owner providers to sync',
        );
        viewerDocument.getText('content').insert(0, 'view-only update');
        await sleep(200);
        expect(ownerDocument.getText('content').toString()).toBe('');
        const persisted = await pool.query<{ ydoc: Buffer | null }>(
          'select ydoc from pages where id = $1',
          [page.id],
        );
        expect(persisted.rows[0]?.ydoc).toBeNull();
      } finally {
        viewerProvider.destroy();
        ownerProvider.destroy();
      }
    });

    it('rejects every viewer write envelope while allowing the same bytes from an owner', async () => {
      const owner = await createTestUser(pool);
      const viewer = await createTestUser(pool);
      const page = await createTestPage(pool, owner.id);
      await pool.query(
        `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         values ('page', $1, $2, $3, 'view')`,
        [page.id, owner.id, viewer.id],
      );
      const viewerSession = await createTestSession(pool, viewer.id);
      const ownerSession = await createTestSession(pool, owner.id);
      const viewerContext = await server.hocuspocus.hooks(
        'onAuthenticate',
        createAuthenticatePayload(server, { documentName: page.id, token: viewerSession.token }),
      );
      const ownerContext = await server.hocuspocus.hooks(
        'onAuthenticate',
        createAuthenticatePayload(server, { documentName: page.id, token: ownerSession.token }),
      );
      const document = new Document(page.id);
      const viewerConnection = {
        context: viewerContext,
        readOnly: true,
        send: vi.fn(),
        sendStateless: vi.fn(),
        close: vi.fn(),
      } as unknown as beforeHandleMessagePayload['connection'];
      const ownerConnection = {
        context: ownerContext,
        readOnly: false,
        send: vi.fn(),
        sendStateless: vi.fn(),
        close: vi.fn(),
      } as unknown as beforeHandleMessagePayload['connection'];
      for (const messageType of [0, 4] as const) {
        for (const syncType of [1, 2] as const) {
          const rejectedDocument = new Y.Doc();
          rejectedDocument
            .getText('content')
            .insert(0, `rejected envelope ${messageType}:${syncType}`);
          const rejectedUpdate = Y.encodeStateAsUpdate(rejectedDocument);
          const basePayload = {
            clientsCount: 2,
            document,
            documentName: page.id,
            instance: server.hocuspocus,
            requestHeaders: {},
            requestParameters: new URLSearchParams(),
            socketId: crypto.randomUUID(),
            update: encodeYjsUpdateMessage(page.id, rejectedUpdate, { messageType, syncType }),
          };

          await expect(
            server.hocuspocus.hooks('beforeHandleMessage', {
              ...basePayload,
              context: viewerContext,
              connection: viewerConnection,
            }),
          ).resolves.toBeUndefined();
          await expect(
            server.hocuspocus.hooks('beforeHandleMessage', {
              ...basePayload,
              context: ownerContext,
              connection: ownerConnection,
            }),
          ).resolves.toBeUndefined();
          Y.applyUpdate(document, rejectedUpdate);
        }
      }

      expect(document.getText('content').toString()).toContain('rejected envelope');
      expect(viewerConnection.readOnly).toBe(true);
      expect(viewerConnection.close).not.toHaveBeenCalled();
      expect(ownerConnection.close).not.toHaveBeenCalled();
    });

    it('does not let a rejected viewer envelope poison an already-active owner replica', async () => {
      const owner = await createTestUser(pool);
      const viewer = await createTestUser(pool);
      const page = await createTestPage(pool, owner.id);
      await pool.query(
        `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         values ('page', $1, $2, $3, 'view')`,
        [page.id, owner.id, viewer.id],
      );
      const viewerSession = await createTestSession(pool, viewer.id);
      const ownerSession = await createTestSession(pool, owner.id);
      const replicaServer = createCollabServer({
        port: 0,
        internalSecret: 'test-collaboration-internal-secret',
        pool,
        logger: mockLogger(),
        permissionRevalidationMs: 0,
      });
      const replicaContext = await replicaServer.hocuspocus.hooks(
        'onAuthenticate',
        createAuthenticatePayload(replicaServer, {
          documentName: page.id,
          token: ownerSession.token,
        }),
      );
      const replicaDocument = new Document(page.id);
      await replicaServer.hocuspocus.hooks('onLoadDocument', {
        context: replicaContext,
        document: replicaDocument,
        documentName: page.id,
        instance: replicaServer.hocuspocus,
        requestHeaders: {},
        requestParameters: new URLSearchParams(),
        socketId: crypto.randomUUID(),
        connectionConfig: createConnectionConfig(),
      });
      const viewerContext = await server.hocuspocus.hooks(
        'onAuthenticate',
        createAuthenticatePayload(server, { documentName: page.id, token: viewerSession.token }),
      );
      const rejectedDocument = new Y.Doc();
      rejectedDocument.getText('content').insert(0, 'cross-replica rejected update');
      const rejectedUpdate = Y.encodeStateAsUpdate(rejectedDocument);
      const updateMessage = encodeYjsUpdateMessage(page.id, rejectedUpdate);
      const viewerConnection = {
        context: viewerContext,
        readOnly: true,
        sendStateless: vi.fn(),
        close: vi.fn(),
      } as unknown as beforeHandleMessagePayload['connection'];
      const replicaConnection = {
        context: replicaContext,
        readOnly: false,
        sendStateless: vi.fn(),
        close: vi.fn(),
      } as unknown as beforeHandleMessagePayload['connection'];

      try {
        await expect(
          server.hocuspocus.hooks('beforeHandleMessage', {
            clientsCount: 1,
            context: viewerContext,
            document: new Document(page.id),
            documentName: page.id,
            instance: server.hocuspocus,
            requestHeaders: {},
            requestParameters: new URLSearchParams(),
            socketId: crypto.randomUUID(),
            update: updateMessage,
            connection: viewerConnection,
          }),
        ).resolves.toBeUndefined();
        expect(viewerConnection.readOnly).toBe(true);
        expect(viewerConnection.close).not.toHaveBeenCalled();
        await expect(
          replicaServer.hocuspocus.hooks('beforeHandleMessage', {
            clientsCount: 1,
            context: replicaContext,
            document: replicaDocument,
            documentName: page.id,
            instance: replicaServer.hocuspocus,
            requestHeaders: {},
            requestParameters: new URLSearchParams(),
            socketId: crypto.randomUUID(),
            update: updateMessage,
            connection: replicaConnection,
          }),
        ).resolves.toBeUndefined();
        expect(replicaConnection.close).not.toHaveBeenCalled();
      } finally {
        await replicaServer.destroy();
      }
    });

    it('keeps the page owner-loadable and editable after a 1026-client viewer envelope', async () => {
      const owner = await createTestUser(pool);
      const viewer = await createTestUser(pool);
      const page = await createTestPage(pool, owner.id);
      await pool.query(
        `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         values ('page', $1, $2, $3, 'view')`,
        [page.id, owner.id, viewer.id],
      );
      const viewerSession = await createTestSession(pool, viewer.id);
      const ownerSession = await createTestSession(pool, owner.id);
      const viewerContext = await server.hocuspocus.hooks(
        'onAuthenticate',
        createAuthenticatePayload(server, { documentName: page.id, token: viewerSession.token }),
      );
      const combinedViewerDocument = new Y.Doc();
      for (let index = 0; index < 1026; index++) {
        const clientDocument = new Y.Doc();
        clientDocument.getMap(`client-${index}`).set('value', index);
        Y.applyUpdate(combinedViewerDocument, Y.encodeStateAsUpdate(clientDocument));
      }
      const rejectedUpdate = Y.encodeStateAsUpdate(combinedViewerDocument);
      const viewerConnection = {
        context: viewerContext,
        readOnly: true,
        sendStateless: vi.fn(),
        close: vi.fn(),
      } as unknown as beforeHandleMessagePayload['connection'];

      await expect(
        server.hocuspocus.hooks('beforeHandleMessage', {
          clientsCount: 1,
          context: viewerContext,
          document: new Document(page.id),
          documentName: page.id,
          instance: server.hocuspocus,
          requestHeaders: {},
          requestParameters: new URLSearchParams(),
          socketId: crypto.randomUUID(),
          update: encodeYjsUpdateMessage(page.id, rejectedUpdate),
          connection: viewerConnection,
        }),
      ).resolves.toBeUndefined();
      expect(viewerConnection.readOnly).toBe(true);
      expect(viewerConnection.close).not.toHaveBeenCalled();

      const ownerContext = await server.hocuspocus.hooks(
        'onAuthenticate',
        createAuthenticatePayload(server, { documentName: page.id, token: ownerSession.token }),
      );
      const ownerDocument = new Document(page.id);
      await expect(
        server.hocuspocus.hooks('onLoadDocument', {
          context: ownerContext,
          document: ownerDocument,
          documentName: page.id,
          instance: server.hocuspocus,
          requestHeaders: {},
          requestParameters: new URLSearchParams(),
          socketId: crypto.randomUUID(),
          connectionConfig: createConnectionConfig(),
        }),
      ).resolves.toBeUndefined();
      const ownerEditDocument = new Y.Doc();
      ownerEditDocument.getText('content').insert(0, 'owner remains editable');
      const ownerUpdate = Y.encodeStateAsUpdate(ownerEditDocument);
      const ownerConnection = {
        context: ownerContext,
        readOnly: false,
        sendStateless: vi.fn(),
        close: vi.fn(),
      } as unknown as beforeHandleMessagePayload['connection'];
      await expect(
        server.hocuspocus.hooks('beforeHandleMessage', {
          clientsCount: 1,
          context: ownerContext,
          document: ownerDocument,
          documentName: page.id,
          instance: server.hocuspocus,
          requestHeaders: {},
          requestParameters: new URLSearchParams(),
          socketId: crypto.randomUUID(),
          update: encodeYjsUpdateMessage(page.id, ownerUpdate),
          connection: ownerConnection,
        }),
      ).resolves.toBeUndefined();
      Y.applyUpdate(ownerDocument, ownerUpdate);
      await server.hocuspocus.hooks('onChange', {
        clientsCount: 1,
        context: ownerContext,
        document: ownerDocument,
        documentName: page.id,
        instance: server.hocuspocus,
        requestHeaders: {},
        requestParameters: new URLSearchParams(),
        socketId: crypto.randomUUID(),
        transactionOrigin: ownerConnection,
        update: ownerUpdate,
      });
      await server.hocuspocus.hooks('onStoreDocument', {
        clientsCount: 1,
        context: ownerContext,
        document: ownerDocument,
        documentName: page.id,
        instance: server.hocuspocus,
        requestHeaders: {},
        requestParameters: new URLSearchParams(),
        socketId: crypto.randomUUID(),
      });
      const persisted = await pool.query<{ ydoc: Buffer | null }>(
        'select ydoc from pages where id = $1',
        [page.id],
      );
      const persistedDocument = new Y.Doc();
      Y.applyUpdate(persistedDocument, new Uint8Array(persisted.rows[0]?.ydoc ?? []));
      expect(persistedDocument.getText('content').toString()).toBe('owner remains editable');
      expect(persistedDocument.share.has('client-0')).toBe(false);
      expect(persistedDocument.share.has('client-1025')).toBe(false);
      expect(ownerConnection.close).not.toHaveBeenCalled();
    });

    it('closes only malformed viewer writers and preserves an owner pending edit', async () => {
      const owner = await createTestUser(pool);
      const viewer = await createTestUser(pool);
      const page = await createTestPage(pool, owner.id);
      await pool.query(
        `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         values ('page', $1, $2, $3, 'view')`,
        [page.id, owner.id, viewer.id],
      );
      const ownerSession = await createTestSession(pool, owner.id);
      const viewerSession = await createTestSession(pool, viewer.id);
      const ownerContext = await server.hocuspocus.hooks(
        'onAuthenticate',
        createAuthenticatePayload(server, { documentName: page.id, token: ownerSession.token }),
      );
      const viewerContext = await server.hocuspocus.hooks(
        'onAuthenticate',
        createAuthenticatePayload(server, { documentName: page.id, token: viewerSession.token }),
      );
      const document = new Document(page.id);
      await server.hocuspocus.hooks('onLoadDocument', {
        context: ownerContext,
        document,
        documentName: page.id,
        instance: server.hocuspocus,
        requestHeaders: {},
        requestParameters: new URLSearchParams(),
        socketId: crypto.randomUUID(),
        connectionConfig: createConnectionConfig(),
      });
      server.hocuspocus.documents.set(page.id, document);
      const ownerConnection = {
        context: ownerContext,
        readOnly: false,
        sendStateless: vi.fn(),
        close: vi.fn(),
      } as unknown as beforeHandleMessagePayload['connection'];
      const ownerClientDocument = new Y.Doc();
      ownerClientDocument.getText('content').insert(0, 'owner pending edit');
      const ownerUpdate = Y.encodeStateAsUpdate(ownerClientDocument);
      const payloadBase = {
        clientsCount: 2,
        document,
        documentName: page.id,
        instance: server.hocuspocus,
        requestHeaders: {},
        requestParameters: new URLSearchParams(),
        socketId: crypto.randomUUID(),
      };

      try {
        await server.hocuspocus.hooks('beforeHandleMessage', {
          ...payloadBase,
          context: ownerContext,
          update: encodeYjsUpdateMessage(page.id, ownerUpdate),
          connection: ownerConnection,
        });
        Y.applyUpdate(document, ownerUpdate);
        await server.hocuspocus.hooks('onChange', {
          ...payloadBase,
          context: ownerContext,
          transactionOrigin: ownerConnection,
          update: ownerUpdate,
        });

        for (const syncType of [1, 2] as const) {
          const viewerConnection = {
            context: viewerContext,
            readOnly: true,
            sendStateless: vi.fn(),
            close: vi.fn(),
          } as unknown as beforeHandleMessagePayload['connection'];
          await expect(
            server.hocuspocus.hooks('beforeHandleMessage', {
              ...payloadBase,
              context: viewerContext,
              update: encodeYjsUpdateMessage(page.id, Uint8Array.of(0xff), { syncType }),
              connection: viewerConnection,
            }),
          ).resolves.toBeUndefined();
          expect(viewerConnection.readOnly).toBe(true);
          expect(viewerConnection.close).not.toHaveBeenCalled();
        }

        expect(ownerConnection.close).not.toHaveBeenCalled();
        expect(document.getText('content').toString()).toBe('owner pending edit');
        await server.hocuspocus.hooks('onStoreDocument', {
          ...payloadBase,
          context: ownerContext,
        });
        const persisted = await pool.query<{ ydoc: Buffer | null }>(
          'select ydoc from pages where id = $1',
          [page.id],
        );
        const persistedDocument = new Y.Doc();
        Y.applyUpdate(persistedDocument, new Uint8Array(persisted.rows[0]?.ydoc ?? []));
        expect(persistedDocument.getText('content').toString()).toBe('owner pending edit');
      } finally {
        server.hocuspocus.documents.delete(page.id);
      }
    });

    it('persists an edit admitted before a downgrade without evicting the room', async () => {
      const owner = await createTestUser(pool);
      const editor = await createTestUser(pool);
      const page = await createTestPage(pool, owner.id);
      await pool.query(
        `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         values ('page', $1, $2, $3, 'edit')`,
        [page.id, owner.id, editor.id],
      );
      const session = await createTestSession(pool, editor.id);
      const context = await server.hocuspocus.hooks(
        'onAuthenticate',
        createAuthenticatePayload(server, { documentName: page.id, token: session.token }),
      );
      const document = new Document(page.id);
      await server.hocuspocus.hooks('onLoadDocument', {
        context,
        document,
        documentName: page.id,
        instance: server.hocuspocus,
        requestHeaders: {},
        requestParameters: new URLSearchParams(),
        socketId: crypto.randomUUID(),
        connectionConfig: createConnectionConfig(),
      });
      const clientDocument = new Y.Doc();
      clientDocument.getText('content').insert(0, 'authorized before downgrade');
      const update = Y.encodeStateAsUpdate(clientDocument);
      const connection = {
        context,
        readOnly: false,
        sendStateless: vi.fn(),
        close: vi.fn(),
      } as unknown as beforeHandleMessagePayload['connection'];

      await server.hocuspocus.hooks('beforeHandleMessage', {
        clientsCount: 2,
        context,
        document,
        documentName: page.id,
        instance: server.hocuspocus,
        requestHeaders: {},
        requestParameters: new URLSearchParams(),
        socketId: crypto.randomUUID(),
        update: encodeYjsUpdateMessage(page.id, update),
        connection,
      });
      Y.applyUpdate(document, update);
      await server.hocuspocus.hooks('onChange', {
        clientsCount: 2,
        context,
        document,
        documentName: page.id,
        instance: server.hocuspocus,
        requestHeaders: {},
        requestParameters: new URLSearchParams(),
        socketId: crypto.randomUUID(),
        transactionOrigin: connection,
        update,
      });
      await pool.query(
        `update shares set permission = 'view'
         where entity_type = 'page' and entity_id = $1 and recipient_user_id = $2`,
        [page.id, editor.id],
      );

      await server.hocuspocus.hooks('onStoreDocument', {
        clientsCount: 2,
        context,
        document,
        documentName: page.id,
        instance: server.hocuspocus,
        requestHeaders: {},
        requestParameters: new URLSearchParams(),
        socketId: crypto.randomUUID(),
      });

      const stored = await pool.query<{ ydoc: Buffer | null }>(
        'select ydoc from pages where id = $1',
        [page.id],
      );
      expect(stored.rows[0]?.ydoc).not.toBeNull();
      const storedDocument = new Y.Doc();
      Y.applyUpdate(storedDocument, new Uint8Array(stored.rows[0]?.ydoc ?? []));
      expect(storedDocument.getText('content').toString()).toBe('authorized before downgrade');
      expect(connection.close).not.toHaveBeenCalled();
    });

    it('preserves an admitted edit when Trash commits before Yjs applies it', async () => {
      const owner = await createTestUser(pool);
      const page = await createTestPage(pool, owner.id);
      const session = await createTestSession(pool, owner.id);
      const context = await server.hocuspocus.hooks(
        'onAuthenticate',
        createAuthenticatePayload(server, { documentName: page.id, token: session.token }),
      );
      const document = new Document(page.id);
      await server.hocuspocus.hooks('onLoadDocument', {
        context,
        document,
        documentName: page.id,
        instance: server.hocuspocus,
        requestHeaders: {},
        requestParameters: new URLSearchParams(),
        socketId: crypto.randomUUID(),
        connectionConfig: createConnectionConfig(),
      });
      const clientDocument = new Y.Doc();
      clientDocument.getText('content').insert(0, 'linearized before Trash');
      const update = Y.encodeStateAsUpdate(clientDocument);
      const connection = {
        context,
        readOnly: false,
        sendStateless: vi.fn(),
        close: vi.fn(),
      } as unknown as beforeHandleMessagePayload['connection'];
      const payloadBase = {
        clientsCount: 1,
        context,
        document,
        documentName: page.id,
        instance: server.hocuspocus,
        requestHeaders: {},
        requestParameters: new URLSearchParams(),
        socketId: crypto.randomUUID(),
      };

      // The permission fence is the linearization point. Trash commits after
      // it, but before Hocuspocus applies the admitted Yjs message.
      await server.hocuspocus.hooks('beforeHandleMessage', {
        ...payloadBase,
        update: encodeYjsUpdateMessage(page.id, update),
        connection,
      });
      await pool.query(
        `update pages
         set is_deleted = true, deleted_at = now(), updated_at = now()
         where id = $1`,
        [page.id],
      );
      Y.applyUpdate(document, update);
      await server.hocuspocus.hooks('onChange', {
        ...payloadBase,
        transactionOrigin: connection,
        update,
      });
      await server.hocuspocus.hooks('onStoreDocument', payloadBase);

      const trashed = await pool.query<{ is_deleted: boolean; ydoc: Buffer | null }>(
        'select is_deleted, ydoc from pages where id = $1',
        [page.id],
      );
      expect(trashed.rows[0]?.is_deleted).toBe(true);
      const trashedDocument = new Y.Doc();
      Y.applyUpdate(trashedDocument, new Uint8Array(trashed.rows[0]?.ydoc ?? []));
      expect(trashedDocument.getText('content').toString()).toBe('linearized before Trash');

      await pool.query(
        `update pages
         set is_deleted = false, deleted_at = null, updated_at = now()
         where id = $1`,
        [page.id],
      );
      const restoredDocument = new Document(page.id);
      await server.hocuspocus.hooks('onLoadDocument', {
        ...payloadBase,
        document: restoredDocument,
        connectionConfig: createConnectionConfig(),
      });
      expect(restoredDocument.getText('content').toString()).toBe('linearized before Trash');
      expect(connection.close).not.toHaveBeenCalled();
    });
  });
});
