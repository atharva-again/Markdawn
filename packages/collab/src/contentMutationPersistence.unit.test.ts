import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { completeContentIdempotency } from './contentMutationPersistence';

const completion = {
  recordId: randomUUID(),
  principalKey: `token:${randomUUID()}`,
  key: 'retry-key',
  requestHash: 'request-hash',
  response: { results: [], etag: '"revision"' },
};

describe('completeContentIdempotency', () => {
  it('completes the production reservation exactly once', async () => {
    const query = vi.fn(async () => ({ rowCount: 1 }));
    await completeContentIdempotency({ query } as unknown as PoolClient, completion);
    expect(query).toHaveBeenCalledOnce();
  });

  it('rejects a stale or already-completed reservation', async () => {
    const query = vi.fn(async () => ({ rowCount: 0 }));
    await expect(
      completeContentIdempotency({ query } as unknown as PoolClient, completion),
    ).rejects.toThrow('Idempotency reservation is no longer available');
  });
});
