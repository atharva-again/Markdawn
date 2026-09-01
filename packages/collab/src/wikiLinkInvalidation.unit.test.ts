import type { Document, Hocuspocus } from '@hocuspocus/server';
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { createCollabSession } from './collabSession';
import { createConnectionLifecycle } from './connectionLifecycle';
import { broadcastWikiLinkPresentationInvalidation } from './wikiLinkInvalidation';

describe('wiki-link invalidation fanout', () => {
  it('publishes only persisted targets returned for active source documents', async () => {
    const sourceId = '11111111-1111-1111-1111-111111111111';
    const targetId = '22222222-2222-2222-2222-222222222222';
    const sendStateless = vi.fn();
    const document = {
      getConnections: () => [
        {
          sendStateless,
          context: createCollabSession({
            principal: {
              kind: 'account',
              user: {
                id: 'user-1',
                email: 'user@example.com',
                name: 'User',
                avatarUrl: null,
              },
              credential: { kind: 'session', raw: 'session-token' },
            },
            permission: 'view',
            accessRevision: '1',
            lifecycle: createConnectionLifecycle(),
          }),
        },
      ],
    } as unknown as Document;
    const hocuspocus = {
      documents: new Map([[sourceId, document]]),
    } as unknown as Hocuspocus;
    const query = vi.fn().mockResolvedValue({
      rows: [{ source_id: sourceId, target_id: targetId }],
    });
    const executor = { query } as unknown as Pick<PoolClient, 'query'>;

    await expect(
      broadcastWikiLinkPresentationInvalidation(
        hocuspocus,
        executor,
        { targetPageIds: [targetId] },
        { recipientUserId: 'user-1' },
      ),
    ).resolves.toBe(1);
    expect(JSON.parse(sendStateless.mock.calls[0]?.[0] as string)).toEqual({
      type: 'wiki_link_presentations_changed',
      targetIds: [targetId],
    });
  });

  it('does not treat an anonymous connection with an account ID as that account', async () => {
    const sourceId = '11111111-1111-1111-1111-111111111111';
    const targetId = '22222222-2222-2222-2222-222222222222';
    const accountSend = vi.fn();
    const anonymousSend = vi.fn();
    const document = {
      getConnections: () => [
        {
          sendStateless: accountSend,
          context: createCollabSession({
            principal: {
              kind: 'account',
              user: {
                id: 'user-1',
                email: 'user@example.com',
                name: 'User',
                avatarUrl: null,
              },
              credential: { kind: 'session', raw: 'session-token' },
            },
            permission: 'view',
            accessRevision: '1',
            lifecycle: createConnectionLifecycle(),
          }),
        },
        {
          sendStateless: anonymousSend,
          context: createCollabSession({
            principal: {
              kind: 'anonymous',
              user: { id: 'user-1', name: 'Anonymous' },
              sessionToken: 'anon:user-1',
            },
            permission: 'view',
            accessRevision: '1',
            lifecycle: createConnectionLifecycle(),
          }),
        },
      ],
    } as unknown as Document;
    const hocuspocus = {
      documents: new Map([[sourceId, document]]),
    } as unknown as Hocuspocus;
    const executor = {
      query: vi.fn().mockResolvedValue({ rows: [{ source_id: sourceId, target_id: targetId }] }),
    } as unknown as Pick<PoolClient, 'query'>;

    await expect(
      broadcastWikiLinkPresentationInvalidation(
        hocuspocus,
        executor,
        { targetPageIds: [targetId] },
        { recipientUserId: 'user-1' },
      ),
    ).resolves.toBe(1);
    expect(accountSend).toHaveBeenCalledOnce();
    expect(anonymousSend).not.toHaveBeenCalled();
  });
});
