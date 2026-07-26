import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { revalidateActivePageConnections } from './permission-handler';
import {
  createConnection,
  createDocument,
  createLogger,
  createServerWithDocuments,
} from './permissionHandlerTestUtils';

describe('revalidateActivePageConnections', () => {
  it('revokes stale access with batched authenticated and anonymous lookups', async () => {
    const logger = createLogger();
    const pageId = '00000000-0000-4000-8000-000000000001';
    const userId = '00000000-0000-4000-8000-000000000002';
    const revokedConnection = createConnection({
      context: { user: { id: userId }, permission: 'view', sessionToken: 'session-1' },
      readOnly: true,
    });
    const anonymousConnection = createConnection({
      context: { user: { id: 'anonymous-1', isAnonymous: true }, permission: 'edit' },
    });
    const server = createServerWithDocuments(
      new Map([[pageId, createDocument([revokedConnection, anonymousConnection])]]),
    );
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('unnest($1::uuid[], $2::uuid[], $3::text[])')) {
        return {
          rows: [
            {
              page_id: pageId,
              user_id: userId,
              credential_raw: 'session-1',
              permission: null,
              access_revision: '103',
            },
          ],
        };
      }
      if (sql.includes('get_public_page_permission')) {
        return { rows: [{ page_id: pageId, permission: 'edit', access_revision: '103' }] };
      }
      return { rows: [] };
    });

    const affected = await revalidateActivePageConnections(
      server,
      { query } as unknown as Pool,
      logger,
    );

    expect(query).toHaveBeenCalledTimes(2);
    expect(affected).toBe(1);
    expect(revokedConnection.close).toHaveBeenCalledWith({ code: 4401, reason: 'Access revoked' });
    expect(anonymousConnection.close).not.toHaveBeenCalled();
  });

  it('fails closed with a verification error when a batch query fails', async () => {
    const logger = createLogger();
    const pageId = '00000000-0000-4000-8000-000000000003';
    const userId = '00000000-0000-4000-8000-000000000004';
    const connection = createConnection({
      context: { user: { id: userId }, permission: 'edit', sessionToken: 'session-2' },
    });
    const server = createServerWithDocuments(new Map([[pageId, createDocument([connection])]]));
    const pool = {
      query: vi.fn(async () => {
        throw new Error('database unavailable');
      }),
    } as unknown as Pool;

    await revalidateActivePageConnections(server, pool, logger);

    expect(connection.close).toHaveBeenCalledWith({
      code: 4500,
      reason: 'Permission verification failed',
    });
    expect(connection.sendStateless).not.toHaveBeenCalled();
  });
});
