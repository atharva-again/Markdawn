import { HocuspocusProvider } from '@hocuspocus/provider';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { createCollabServer } from '../src/server';
import { createTestPage, createTestSession, createTestUser, getTestPool } from '../src/test-utils';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

describe('collab server stress', () => {
  const pool = getTestPool();
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  } as unknown as ReturnType<typeof import('@logtape/logtape').getLogger>;

  let server: ReturnType<typeof createCollabServer>;
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

  it('handles 20 concurrent providers on same document', async () => {
    const user = await createTestUser(pool);
    const session = await createTestSession(pool, user.id);
    const page = await createTestPage(pool, user.id);

    const providers: HocuspocusProvider[] = [];
    for (let i = 0; i < 20; i++) {
      const provider = new HocuspocusProvider({
        url: `ws://localhost:${port}`,
        name: page.id,
        document: new (await import('yjs')).Doc(),
        token: session.token,
      });
      providers.push(provider);
    }

    await waitFor(() => providers.every((p) => p.synced), 10_000, 'all providers to sync');

    const firstProvider = providers[0] as HocuspocusProvider;
    (firstProvider.document as Y.Doc).getText('content').insert(0, 'Stress test content');

    await waitFor(
      () =>
        providers.every(
          (p) =>
            ((p.document as Y.Doc).getText('content').toString() as string) ===
            'Stress test content',
        ),
      5_000,
      'all providers to converge',
    );

    for (const provider of providers) {
      provider.destroy();
    }
  });

  it('handles rapid connect/disconnect cycles', async () => {
    const user = await createTestUser(pool);
    const session = await createTestSession(pool, user.id);
    const page = await createTestPage(pool, user.id);

    for (let i = 0; i < 10; i++) {
      const provider = new HocuspocusProvider({
        url: `ws://localhost:${port}`,
        name: page.id,
        document: new (await import('yjs')).Doc(),
        token: session.token,
      });

      await waitFor(() => provider.synced, 5_000, `provider ${i} to sync`);
      provider.destroy();
    }

    // Wait for async disconnect cleanup to complete (force-save is async)
    await waitFor(
      () => server.hocuspocus.documents.size <= 1,
      3_000,
      'document cleanup after rapid connect/disconnect',
    );
    expect(server.hocuspocus.documents.size).toBeLessThanOrEqual(1);
  });
});
