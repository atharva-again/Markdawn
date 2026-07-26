import type { Logger } from '@logtape/logtape';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { createAccessVerifier, withSerializedPermissionCheck } from './accessVerifier';
import { CollabAccessError, CollabVerificationError } from './collabErrors';
import { type CollabSession, createCollabSession } from './collabSession';
import { createConnectionLifecycle } from './hocuspocusV3Adapter';

const logger = {
  debug: vi.fn(),
} as unknown as Logger;

describe('access verifier', () => {
  it('accepts only the authenticated user metadata room', async () => {
    const verifier = createAccessVerifier({} as Pool, logger);
    await expect(verifier.assertMetaRoomAccess('user-1', 'user-1')).resolves.toBeUndefined();
    await expect(verifier.assertMetaRoomAccess('user-1', 'user-2')).rejects.toBeInstanceOf(
      CollabAccessError,
    );
  });

  it('serializes permission checks after a rejected predecessor', async () => {
    const order: string[] = [];
    const context: CollabSession = createCollabSession({
      principal: {
        kind: 'account',
        user: { id: 'user-1', email: 'user@example.com', name: 'User', avatarUrl: null },
        credential: { kind: 'session', raw: 'session-1' },
      },
      permission: 'edit',
      accessRevision: '1',
      lifecycle: createConnectionLifecycle(),
    });
    const first = withSerializedPermissionCheck(context, async () => {
      order.push('first');
      throw new Error('verification failed');
    });
    const second = withSerializedPermissionCheck(context, async () => {
      order.push('second');
      return 'ok';
    });

    await expect(first).rejects.toThrow('verification failed');
    await expect(second).resolves.toBe('ok');
    expect(order).toEqual(['first', 'second']);
  });

  it('returns canonical page access and rejects invalid sessions', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            page_id: 'page-1',
            user_id: 'user-1',
            credential_raw: 'valid-session',
            permission: 'edit',
            access_revision: '12',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            page_id: 'page-1',
            user_id: 'user-1',
            credential_raw: 'session',
            permission: null,
            access_revision: '13',
          },
        ],
      });
    const verifier = createAccessVerifier({ query } as unknown as Pool, logger);

    await expect(
      verifier.assertPageAccess('page-1', 'user-1', {
        kind: 'session',
        raw: 'valid-session',
      }),
    ).resolves.toEqual({ permission: 'edit', accessRevision: '12' });
    await expect(
      verifier.assertPageAccess('page-1', 'user-1', { kind: 'session', raw: 'session' }),
    ).rejects.toEqual(expect.objectContaining({ accessRevision: '13' }));
  });

  it('distinguishes verification failures from canonical access denial', async () => {
    const query = vi
      .fn()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce({
        rows: [{ page_id: 'page-1', permission: null, access_revision: '20' }],
      });
    const verifier = createAccessVerifier({ query } as unknown as Pool, logger);

    await expect(
      verifier.assertPageAccess('page-1', 'user-1', { kind: 'session', raw: 'session' }),
    ).rejects.toBeInstanceOf(CollabVerificationError);
    await expect(verifier.assertAnonymousPageAccess('page-1')).rejects.toEqual(
      expect.objectContaining({ accessRevision: '20' }),
    );
  });

  it('locks the owning workspace before the active page row', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ owner_id: 'owner-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ title_revision: '7' }] });
    const pool = { query } as unknown as Pool;
    const verifier = createAccessVerifier(pool, logger);

    await verifier.lockDocumentAccessMutation('page-1', pool);
    await expect(verifier.lockActivePage('page-1', pool)).resolves.toBe('7');
    expect(query.mock.calls[1]?.[1]).toEqual(['workspace-access:owner-1']);
  });
});
