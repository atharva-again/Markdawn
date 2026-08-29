import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());
vi.mock('../db/query', () => ({ query: queryMock }));

import { drainOperationalRetention, OPERATIONAL_RETENTION_INTERVAL_MS } from './dataRetention';

describe('drainOperationalRetention', () => {
  beforeEach(() => queryMock.mockReset());

  it('deletes expired records in bounded batches outside request handling', async () => {
    queryMock
      .mockResolvedValueOnce({ rowCount: 1_000 })
      .mockResolvedValueOnce({ rowCount: 1_000 })
      .mockResolvedValueOnce({ rowCount: 500 })
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rowCount: 12 })
      .mockResolvedValueOnce({ rowCount: 7 })
      .mockResolvedValueOnce({ rowCount: 5 })
      .mockResolvedValueOnce({ rowCount: 0 });

    await expect(drainOperationalRetention()).resolves.toEqual({
      idempotencyRecords: 1_012,
      tokenAuditEvents: 1_007,
      oauthClientAssertions: 505,
      oauthAccessTokenRevocations: 0,
    });
    expect(queryMock).toHaveBeenCalledTimes(8);
  });

  it('provides bounded cleanup capacity above sustained API ingestion', async () => {
    expect(OPERATIONAL_RETENTION_INTERVAL_MS).toBe(60_000);
    queryMock.mockResolvedValue({ rowCount: 1_000 });

    await expect(drainOperationalRetention()).resolves.toEqual({
      idempotencyRecords: 100_000,
      tokenAuditEvents: 100_000,
      oauthClientAssertions: 100_000,
      oauthAccessTokenRevocations: 100_000,
    });
    expect(queryMock).toHaveBeenCalledTimes(400);
  });
});
