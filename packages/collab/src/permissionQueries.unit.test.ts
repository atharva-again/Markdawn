import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  credentialPagePermissionKey,
  queryAnonymousPagePermissions,
  queryCredentialPagePermissions,
} from './permissionQueries';

describe('permission queries', () => {
  it('keys authenticated snapshots by session only when session validation is requested', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            page_id: 'page-1',
            user_id: 'user-1',
            credential_raw: 'session-1',
            permission: 'edit',
            access_revision: '9',
          },
        ],
      }),
    } as unknown as Pool;
    const candidate = {
      pageId: 'page-1',
      userId: 'user-1',
      credential: { kind: 'session' as const, raw: 'session-1' },
    };

    const states = await queryCredentialPagePermissions(pool, [candidate]);
    expect(states.get(credentialPagePermissionKey(candidate))).toEqual({
      permission: 'edit',
      accessRevision: '9',
    });
  });

  it('normalizes unknown anonymous permissions to denied state', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ page_id: 'page-1', permission: 'owner', access_revision: '10' }],
      }),
    } as unknown as Pool;
    await expect(queryAnonymousPagePermissions(pool, ['page-1'])).resolves.toEqual(
      new Map([['page-1', { permission: null, accessRevision: '10' }]]),
    );
  });

  it('authorizes trusted internal commands from account permissions', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            page_id: 'page-1',
            user_id: 'user-1',
            permission: 'edit',
            access_revision: '11',
          },
        ],
      }),
    } as unknown as Pool;
    const candidate = {
      pageId: 'page-1',
      userId: 'user-1',
      credential: {
        kind: 'internal' as const,
        raw: 'request-1',
        tokenId: null,
        idempotencyPrincipal: 'session:hash',
      },
    };

    const states = await queryCredentialPagePermissions(pool, [candidate]);
    expect(states.get(credentialPagePermissionKey(candidate))).toEqual({
      permission: 'edit',
      accessRevision: '11',
    });
  });
});
