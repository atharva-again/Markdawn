import { HocuspocusProvider } from '@hocuspocus/provider';
import type { Server } from '@hocuspocus/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createCollabServer } from './server';
import {
  canonicalTestAwarenessUser,
  createMockLogger as mockLogger,
  sleep,
  waitFor,
} from './serverTestHarness';
import { createTestPage, createTestSession, createTestUser, getTestPool } from './test-utils';

describe('collab server provider convergence', () => {
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

  it('syncs awareness state between connected providers', async () => {
    const user = await createTestUser(pool);
    const session = await createTestSession(pool, user.id);
    const page = await createTestPage(pool, user.id);

    const provider1 = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: new Y.Doc(),
      token: session.token,
    });
    const provider2 = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: new Y.Doc(),
      token: session.token,
    });

    await waitFor(() => provider1.synced && provider2.synced, 5_000, 'awareness providers to sync');
    provider1.setAwarenessField('user', canonicalTestAwarenessUser(user.id));

    await waitFor(
      () => {
        for (const state of provider2.awareness?.getStates().values() ?? []) {
          if ((state as { user?: { name?: string } }).user?.name === 'Test User') {
            return true;
          }
        }
        return false;
      },
      5_000,
      'awareness state propagation',
    );

    provider1.destroy();
    provider2.destroy();
  });

  it('re-syncs document state after a provider reconnects', async () => {
    const user = await createTestUser(pool);
    const session = await createTestSession(pool, user.id);
    const page = await createTestPage(pool, user.id);

    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const providerA = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: docA,
      token: session.token,
    });
    const providerB = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: docB,
      token: session.token,
    });

    await waitFor(() => providerA.synced && providerB.synced, 5_000, 'initial provider sync');
    providerB.destroy();

    docA.getText('content').insert(0, 'Reconnect content');

    await waitFor(
      async () => {
        const res = await pool.query('SELECT ydoc FROM pages WHERE id = $1', [page.id]);
        return res.rows[0]?.ydoc !== null;
      },
      5_000,
      'post-disconnect persistence',
    );

    const docReconnected = new Y.Doc();
    const reconnectedProviderB = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: docReconnected,
      token: session.token,
    });

    await waitFor(() => reconnectedProviderB.synced, 5_000, 'reconnected provider sync');
    expect(docReconnected.getText('content').toString()).toBe('Reconnect content');

    providerA.destroy();
    reconnectedProviderB.destroy();
  });

  it('converges concurrent edits from two providers', async () => {
    const user = await createTestUser(pool);
    const session = await createTestSession(pool, user.id);
    const page = await createTestPage(pool, user.id);

    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    const provider1 = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: doc1,
      token: session.token,
    });

    const provider2 = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: doc2,
      token: session.token,
    });

    await waitFor(() => provider1.synced && provider2.synced, 5_000, 'both providers to sync');

    doc1.getText('content').insert(0, 'Hello ');
    doc2.getText('content').insert(6, 'World');

    await waitFor(
      () => doc1.getText('content').toString() === doc2.getText('content').toString(),
      5_000,
      'documents to converge',
    );

    const text1 = doc1.getText('content').toString();
    const text2 = doc2.getText('content').toString();
    expect(text1).toBe(text2);
    expect(text1).toContain('Hello');
    expect(text1).toContain('World');

    provider1.destroy();
    provider2.destroy();
  });

  it('clears awareness state when a provider disconnects', async () => {
    const user = await createTestUser(pool);
    const session = await createTestSession(pool, user.id);
    const page = await createTestPage(pool, user.id);

    const provider1 = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: new Y.Doc(),
      token: session.token,
    });
    const provider2 = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: new Y.Doc(),
      token: session.token,
    });

    await waitFor(() => provider1.synced && provider2.synced, 5_000, 'providers to sync');
    provider1.setAwarenessField('user', canonicalTestAwarenessUser(user.id));

    await waitFor(
      () => {
        for (const state of provider2.awareness?.getStates().values() ?? []) {
          if ((state as { user?: { name?: string } }).user?.name === 'Test User') {
            return true;
          }
        }
        return false;
      },
      5_000,
      'awareness to propagate',
    );

    provider1.destroy();
    await sleep(500);

    const remainingStates = Array.from(provider2.awareness?.getStates().entries() ?? []);
    const staleStates = remainingStates.filter(
      ([, state]) => (state as { user?: { name?: string } }).user?.name === 'Test User',
    );
    expect(staleStates).toHaveLength(0);

    provider2.destroy();
  });

  it('restores awareness state after a provider reconnects', async () => {
    const user = await createTestUser(pool);
    const session = await createTestSession(pool, user.id);
    const page = await createTestPage(pool, user.id);

    const observerProvider = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: new Y.Doc(),
      token: session.token,
    });

    await waitFor(() => observerProvider.synced, 5_000, 'observer to sync');

    const provider1 = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: new Y.Doc(),
      token: session.token,
    });
    await waitFor(() => provider1.synced, 5_000, 'provider1 to sync');
    provider1.setAwarenessField('user', canonicalTestAwarenessUser(user.id));

    await waitFor(
      () => {
        for (const state of observerProvider.awareness?.getStates().values() ?? []) {
          if ((state as { user?: { name?: string } }).user?.name === 'Test User') {
            return true;
          }
        }
        return false;
      },
      5_000,
      'initial awareness to propagate',
    );

    provider1.destroy();
    await sleep(300);

    const reconnectedProvider = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: new Y.Doc(),
      token: session.token,
    });
    await waitFor(() => reconnectedProvider.synced, 5_000, 'reconnected provider to sync');

    reconnectedProvider.setAwarenessField('user', canonicalTestAwarenessUser(user.id));

    await waitFor(
      () => {
        for (const state of observerProvider.awareness?.getStates().values() ?? []) {
          if ((state as { user?: { name?: string } }).user?.name === 'Test User') {
            return true;
          }
        }
        return false;
      },
      5_000,
      'reconnected awareness to propagate',
    );

    reconnectedProvider.destroy();
    observerProvider.destroy();
  });
});
