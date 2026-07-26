import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { V1Principal } from '../../middleware/v1Auth';

const queryMock = vi.hoisted(() => vi.fn());
vi.mock('../../db/query', () => ({ query: queryMock }));

import { reserveIdempotency } from './idempotency';

const principal: V1Principal = {
  kind: 'session',
  userId: randomUUID(),
  credential: 'missing-reservation-test',
};

describe('reserveIdempotency', () => {
  beforeEach(() => queryMock.mockReset());

  it('returns a distinct code when a conflicting reservation disappears', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

    await expect(
      reserveIdempotency<{ etag: string }>(principal, 'missing', 'request'),
    ).rejects.toMatchObject({
      status: 409,
      cause: { code: 'idempotency_reservation_missing' },
    });
  });
});
