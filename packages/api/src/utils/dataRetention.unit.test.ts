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
      .mockResolvedValueOnce({ rowCount: 12 })
      .mockResolvedValueOnce({ rowCount: 7 });

    await expect(drainOperationalRetention()).resolves.toEqual({
      idempotencyRecords: 1_012,
      tokenAuditEvents: 1_007,
    });
    expect(queryMock).toHaveBeenCalledTimes(4);
  });

  it('provides bounded cleanup capacity above sustained API ingestion', async () => {
    expect(OPERATIONAL_RETENTION_INTERVAL_MS).toBe(60_000);
    queryMock.mockResolvedValue({ rowCount: 1_000 });

    await expect(drainOperationalRetention()).resolves.toEqual({
      idempotencyRecords: 100_000,
      tokenAuditEvents: 100_000,
    });
    expect(queryMock).toHaveBeenCalledTimes(200);
  });
});
