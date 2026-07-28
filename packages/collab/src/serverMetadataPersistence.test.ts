import { Document, type onStoreDocumentPayload, type Server } from '@hocuspocus/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createCollabServer } from './server';
import {
  createAccountHookContext,
  createConnectionConfig,
  createMockLogger,
} from './serverTestHarness';
import { createTestPage, createTestUser, getTestPool } from './test-utils';

describe('collab server metadata persistence', () => {
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

  it('publishes metadata only through an active user meta room', async () => {
    const owner = await createTestUser(pool);
    const page = await createTestPage(pool, owner.id, 'Original title');
    const metaRoomName = `page-meta:${owner.id}`;
    const metaDocument = new Document(metaRoomName);
    server.hocuspocus.documents.set(metaRoomName, metaDocument);

    try {
      const document = new Document(page.id);
      document.getText('title').insert(0, 'Updated title');
      const payload: onStoreDocumentPayload = {
        clientsCount: 1,
        context: await createAccountHookContext(pool, owner.id),
        document,
        documentName: page.id,
        instance: server.hocuspocus,
        requestHeaders: {},
        requestParameters: new URLSearchParams(),
        socketId: crypto.randomUUID(),
      };

      await server.hocuspocus.hooks('onStoreDocument', payload);

      expect(metaDocument.getMap('pageIndex').get(page.id)).toEqual(
        expect.objectContaining({ title: 'Updated title' }),
      );
      expect(metaDocument.getMap('backlinksVersion').get(page.id)).toEqual(expect.any(Number));
    } finally {
      server.hocuspocus.documents.delete(metaRoomName);
    }
  });

  it('does not overwrite a newer API rename with a stale collaboration save', async () => {
    const owner = await createTestUser(pool);
    const page = await createTestPage(pool, owner.id, 'Original title');
    const document = new Document(page.id);
    const context = await createAccountHookContext(pool, owner.id);
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
    document.getText('content').insert(0, 'local edit');
    await pool.query(
      'update pages set title = $1, title_revision = title_revision + 1 where id = $2',
      ['API title', page.id],
    );

    await server.hocuspocus.hooks('onStoreDocument', {
      clientsCount: 1,
      context,
      document,
      documentName: page.id,
      instance: server.hocuspocus,
      requestHeaders: {},
      requestParameters: new URLSearchParams(),
      socketId: crypto.randomUUID(),
    });

    const stored = await pool.query<{ title: string; ydoc: Buffer | null }>(
      'select title, ydoc from pages where id = $1',
      [page.id],
    );
    const storedDocument = new Y.Doc();
    Y.applyUpdate(storedDocument, new Uint8Array(stored.rows[0]?.ydoc ?? []));
    expect(stored.rows[0]?.title).toBe('API title');
    expect(storedDocument.getText('title').toString()).toBe('API title');
    expect(storedDocument.getText('content').toString()).toBe('local edit');
  });

  it('clears the committed writer when metadata publication fails after commit', async () => {
    const owner = await createTestUser(pool);
    const page = await createTestPage(pool, owner.id, 'Post-commit page');
    const postCommitLogger = createMockLogger();
    let committed = false;
    const connect = vi.fn(async () => {
      const client = await pool.connect();
      return {
        query: async (text: string, values?: unknown[]) => {
          const result = await client.query(text, values);
          if (text === 'COMMIT') committed = true;
          return result;
        },
        release: () => client.release(),
      };
    });
    const postCommitPool = {
      connect,
      query: (text: string, values?: unknown[]) => {
        if (committed) throw new Error('metadata fanout unavailable');
        return pool.query(text, values);
      },
    } as unknown as typeof pool;
    const postCommitServer = createCollabServer({
      port: 0,
      internalSecret: 'test-collaboration-internal-secret',
      pool: postCommitPool,
      logger: postCommitLogger,
      permissionRevalidationMs: 0,
    });
    const document = new Document(page.id);
    document.getText('content').insert(0, 'durably committed');
    const context = await createAccountHookContext(pool, owner.id);
    const metaRoomName = `page-meta:${owner.id}`;
    postCommitServer.hocuspocus.documents.set(metaRoomName, new Document(metaRoomName));
    postCommitServer.hocuspocus.documents.set(page.id, document);
    await postCommitServer.hocuspocus.hooks('onChange', {
      clientsCount: 1,
      context,
      document,
      documentName: page.id,
      instance: postCommitServer.hocuspocus,
      requestHeaders: {},
      requestParameters: new URLSearchParams(),
      socketId: crypto.randomUUID(),
      transactionOrigin: null,
      update: Y.encodeStateAsUpdate(document),
    });

    try {
      await postCommitServer.hocuspocus.hooks('onStoreDocument', {
        clientsCount: 1,
        context,
        document,
        documentName: page.id,
        instance: postCommitServer.hocuspocus,
        requestHeaders: {},
        requestParameters: new URLSearchParams(),
        socketId: crypto.randomUUID(),
      });
      await postCommitServer.hocuspocus.hooks('onDisconnect', {
        clientsCount: 0,
        context,
        document,
        documentName: page.id,
        instance: postCommitServer.hocuspocus,
        requestHeaders: {},
        requestParameters: new URLSearchParams(),
        socketId: crypto.randomUUID(),
      });

      expect(connect).toHaveBeenCalledTimes(1);
      expect(postCommitLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('metadata publication failed after commit'),
      );
      const stored = await pool.query<{ ydoc: Buffer }>('select ydoc from pages where id = $1', [
        page.id,
      ]);
      const storedDocument = new Y.Doc();
      Y.applyUpdate(storedDocument, new Uint8Array(stored.rows[0]?.ydoc ?? []));
      expect(storedDocument.getText('content').toString()).toBe('durably committed');
    } finally {
      postCommitServer.hocuspocus.documents.delete(page.id);
      postCommitServer.hocuspocus.documents.delete(metaRoomName);
      await postCommitServer.destroy();
    }
  });
});
