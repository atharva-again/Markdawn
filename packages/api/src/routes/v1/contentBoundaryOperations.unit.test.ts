import { createHash, randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const principal = {
  kind: 'session' as const,
  userId: randomUUID(),
  credential: 'boundary-operation-test',
};
const queryMock = vi.hoisted(() => vi.fn());
const collaboration = vi.hoisted(() => ({
  applyPageContentBoundaryOperation: vi.fn(),
}));

vi.mock('../../db/query', () => ({ query: queryMock }));
vi.mock('../../middleware/v1Auth', () => ({
  requireV1OperationScope:
    () =>
    async (context: { set: (key: string, value: unknown) => void }, next: () => Promise<void>) => {
      context.set('v1Principal', principal);
      await next();
    },
  v1IdempotencyPrincipal: (value: typeof principal) => value.credential,
}));
vi.mock('../../utils/collaborationContentClient', () => collaboration);

import contentBoundaryOperationsRoute from './contentBoundaryOperations';

describe('v1 content boundary operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards a reservation once and replays its stored response without another mutation', async () => {
    const pageId = randomUUID();
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ pageId, id: 'append', operation: 'append', content: 'One\nTwo' }))
      .digest('base64url');
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 'reservation-id' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ request_hash: requestHash, response: { id: 'append', etag: 'etag' } }],
      });
    collaboration.applyPageContentBoundaryOperation.mockResolvedValue({
      id: 'append',
      etag: 'etag',
    });
    const app = new Hono();
    app.route('/pages', contentBoundaryOperationsRoute);
    const request = () =>
      app.request(`/pages/${pageId}/content-operations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'stable-key' },
        body: JSON.stringify({ id: 'append', operation: 'append', content: 'One\r\nTwo' }),
      });

    const first = await request();
    const replay = await request();

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    await expect(first.json()).resolves.toEqual({ id: 'append', etag: 'etag' });
    await expect(replay.json()).resolves.toEqual({ id: 'append', etag: 'etag' });
    expect(collaboration.applyPageContentBoundaryOperation).toHaveBeenCalledTimes(1);
    expect(collaboration.applyPageContentBoundaryOperation).toHaveBeenCalledWith(
      pageId,
      principal,
      {
        id: 'append',
        operation: 'append',
        content: 'One\nTwo',
        idempotency: {
          recordId: 'reservation-id',
          key: 'stable-key',
          requestHash: expect.any(String),
        },
      },
    );
  });
});
