import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { testQuery } from '../../db/testQuery';
import type { V1Principal } from '../../middleware/v1Auth';
import { reserveIdempotency } from './idempotency';

const principal: V1Principal = {
  kind: 'session',
  userId: randomUUID(),
  credential: `test-session-${randomUUID()}`,
};

describe('v1 idempotency lifecycle', () => {
  afterAll(async () => {
    await testQuery('delete from api_idempotency_records where idempotency_key like $1', [
      'replacement-test-%',
    ]);
  });

  it('replaces an expired reservation with a new record', async () => {
    const key = `replacement-test-${randomUUID()}`;
    const requestHash = 'same-request';
    const first = await reserveIdempotency<{ etag: string }>(principal, key, requestHash);
    if (!first.reserved) throw new Error('Expected the first reservation');
    await testQuery(
      "update api_idempotency_records set expires_at = now() - interval '1 second' where id = $1",
      [first.recordId],
    );

    const replacement = await reserveIdempotency<{ etag: string }>(principal, key, requestHash);
    if (!replacement.reserved) throw new Error('Expected a replacement reservation');
    expect(replacement.recordId).not.toBe(first.recordId);
  });

  it('distinguishes in-progress requests from key mismatches', async () => {
    const key = `replacement-test-${randomUUID()}`;
    const first = await reserveIdempotency<{ etag: string }>(principal, key, 'first-request');
    if (!first.reserved) throw new Error('Expected the first reservation');

    await expect(
      reserveIdempotency<{ etag: string }>(principal, key, 'first-request'),
    ).rejects.toMatchObject({
      status: 409,
      cause: { code: 'idempotency_in_progress', retryAfterSeconds: 1 },
    });
    await expect(
      reserveIdempotency<{ etag: string }>(principal, key, 'different-request'),
    ).rejects.toMatchObject({
      status: 409,
      cause: { code: 'idempotency_key_mismatch' },
    });
  });
});
