import { HocuspocusProvider } from '@hocuspocus/provider';
import { Document, type onDisconnectPayload, type Server } from '@hocuspocus/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createCollabServer } from './server';
import {
  createAccountHookContext,
  createMockLogger,
  createUnverifiedAccountHookContext,
  waitFor,
} from './serverTestHarness';
import { createTestPage, createTestSession, createTestUser, getTestPool } from './test-utils';

describe('collab server disconnect persistence', () => {
  const pool = getTestPool();
  const logger = createMockLogger();
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

  it('returns early when no in-memory document exists', async () => {
    const payload: onDisconnectPayload = {
      clientsCount: 0,
      context: createUnverifiedAccountHookContext(crypto.randomUUID()),
      document: new Document(crypto.randomUUID()),
      documentName: crypto.randomUUID(),
      instance: server.hocuspocus,
      requestHeaders: new Headers(),
      requestParameters: new URLSearchParams(),
      socketId: crypto.randomUUID(),
    };

    await expect(server.hocuspocus.hooks('onDisconnect', payload)).resolves.toBeUndefined();
  });

  it('does not persist or evict the room when a view-only connection disconnects', async () => {
    const isolatedPool = {
      query: vi.fn(async () => {
        throw new Error('viewer disconnect must not query');
      }),
      connect: vi.fn(async () => {
        throw new Error('viewer disconnect must not persist');
      }),
    } as unknown as typeof pool;
    const isolatedServer = createCollabServer({
      port: 0,
      internalSecret: 'test-collaboration-internal-secret',
      pool: isolatedPool,
      logger: createMockLogger(),
      permissionRevalidationMs: 0,
    });
    const documentName = crypto.randomUUID();
    const document = new Document(documentName);
    const remainingConnection = { close: vi.fn() };
    vi.spyOn(document, 'getConnections').mockReturnValue([
      remainingConnection,
    ] as unknown as ReturnType<Document['getConnections']>);
    isolatedServer.hocuspocus.documents.set(documentName, document);

    try {
      await isolatedServer.hocuspocus.hooks('onDisconnect', {
        clientsCount: 1,
        context: createUnverifiedAccountHookContext(crypto.randomUUID(), 'view'),
        document,
        documentName,
        instance: isolatedServer.hocuspocus,
        requestHeaders: new Headers(),
        requestParameters: new URLSearchParams(),
        socketId: crypto.randomUUID(),
      });
      expect(isolatedPool.connect).not.toHaveBeenCalled();
      expect(isolatedPool.query).not.toHaveBeenCalled();
      expect(remainingConnection.close).not.toHaveBeenCalled();
    } finally {
      isolatedServer.hocuspocus.documents.delete(documentName);
      await isolatedServer.destroy();
    }
  });

  it('retains and retries a document after a disconnect persistence failure', async () => {
    const failingLogger = createMockLogger();
    let shouldFailWrite = true;
    const mockClient = {
      query: vi.fn(async (text: string, values?: unknown[]) => {
        if (
          (text.startsWith('update pages set ydoc') ||
            text.startsWith('update "pages" set "ydoc"')) &&
          shouldFailWrite
        ) {
          shouldFailWrite = false;
          throw new Error('disconnect write failed');
        }
        return pool.query(text, values);
      }),
      release: vi.fn(),
    };
    const failingPool = {
      connect: vi.fn(async () => mockClient),
      query: vi.fn(async (text: string, values?: unknown[]) => pool.query(text, values)),
    } as unknown as typeof pool;
    const failingServer = createCollabServer({
      port: 0,
      internalSecret: 'test-collaboration-internal-secret',
      pool: failingPool,
      logger: failingLogger,
      debounceMs: 50,
      maxDebounceMs: 100,
      permissionRevalidationMs: 0,
    });

    const user = await createTestUser(pool);
    const page = await createTestPage(pool, user.id);
    const document = new Document(page.id);
    document.getText('content').insert(0, 'pending');
    failingServer.hocuspocus.documents.set(page.id, document);
    const context = await createAccountHookContext(pool, user.id);
    await failingServer.hocuspocus.hooks('onChange', {
      clientsCount: 1,
      context,
      document,
      documentName: page.id,
      instance: failingServer.hocuspocus,
      requestHeaders: new Headers(),
      requestParameters: new URLSearchParams(),
      socketId: crypto.randomUUID(),
      transactionOrigin: null,
      update: Y.encodeStateAsUpdate(document),
    });

    await expect(
      failingServer.hocuspocus.hooks('onDisconnect', {
        clientsCount: 0,
        context,
        document,
        documentName: page.id,
        instance: failingServer.hocuspocus,
        requestHeaders: new Headers(),
        requestParameters: new URLSearchParams(),
        socketId: crypto.randomUUID(),
      }),
    ).resolves.toBeUndefined();
    expect(failingLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(`[disconnect] force save failed for "${page.id}"; retrying`),
    );
    failingServer.hocuspocus.documents.delete(page.id);
  });

  it('force-saves document when provider disconnects before debounce', async () => {
    const user = await createTestUser(pool);
    const session = await createTestSession(pool, user.id);
    const page = await createTestPage(pool, user.id);
    const document = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document,
      token: session.token,
    });

    await waitFor(() => provider.synced, 5_000, 'provider to sync');
    document.getText('content').insert(0, 'Disconnect save');
    provider.destroy();
    await waitFor(
      async () => {
        const result = await pool.query('SELECT ydoc FROM pages WHERE id = $1', [page.id]);
        return result.rows[0]?.ydoc !== null;
      },
      5_000,
      'disconnect force save',
    );

    const result = await pool.query('SELECT ydoc FROM pages WHERE id = $1', [page.id]);
    const loadedDocument = new Y.Doc();
    Y.applyUpdate(loadedDocument, new Uint8Array(result.rows[0].ydoc as Buffer));
    expect(loadedDocument.getText('content').toString()).toBe('Disconnect save');
  });

  it('handles disconnect gracefully for a fresh in-memory document', async () => {
    const documentName = crypto.randomUUID();
    const document = new Document(documentName);
    server.hocuspocus.documents.set(documentName, document);
    await expect(
      server.hocuspocus.hooks('onDisconnect', {
        clientsCount: 0,
        context: createUnverifiedAccountHookContext(crypto.randomUUID()),
        document,
        documentName,
        instance: server.hocuspocus,
        requestHeaders: new Headers(),
        requestParameters: new URLSearchParams(),
        socketId: crypto.randomUUID(),
      }),
    ).resolves.toBeUndefined();
    server.hocuspocus.documents.delete(documentName);
  });
});
