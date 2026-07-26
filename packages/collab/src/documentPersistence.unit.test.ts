import type { Hocuspocus } from '@hocuspocus/server';
import type { Logger } from '@logtape/logtape';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { contentMetadataHash } from './contentRevision';
import { persistDocument } from './documentPersistence';
import { DocumentSizeLimitError } from './documentSizeError';

const logger = { warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
const hocuspocus = { documents: new Map() } as unknown as Hocuspocus;

function createPool(query: ReturnType<typeof vi.fn>) {
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  return {
    pool: { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool,
    client,
  };
}

describe('document persistence', () => {
  it('rolls back without publishing when the page disappeared', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const { pool, client } = createPool(query);
    const document = new Y.Doc();

    await expect(
      persistDocument({
        pool,
        hocuspocus,
        documentName: 'page-1',
        document,
        connectionSnapshotState: Y.encodeStateAsUpdate(document),
        connectionResolutionPrincipals: [],
        lastCanonicalTitle: undefined,
        getPendingTitleBaseline: () => undefined,
        maxDocumentBytes: 1024,
        logger,
        expectedContentHash: undefined,
      }),
    ).resolves.toEqual({ committed: false });
    expect(query.mock.calls.map(([statement]) => String(statement).toLowerCase())).toEqual([
      'begin',
      expect.stringContaining('from pages where id = $1 for update'),
      'rollback',
    ]);
    expect(client.release).toHaveBeenCalledOnce();
    document.destroy();
  });

  it('refuses to merge a stale active document after canonical content was replaced', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            ydoc: Buffer.from('replacement'),
            title: 'Page',
            is_deleted: false,
            title_revision: '1',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    const { pool, client } = createPool(query);
    const document = new Y.Doc();

    await expect(
      persistDocument({
        pool,
        hocuspocus,
        documentName: 'page-1',
        document,
        connectionSnapshotState: Y.encodeStateAsUpdate(document),
        connectionResolutionPrincipals: [],
        lastCanonicalTitle: 'Page',
        getPendingTitleBaseline: () => undefined,
        maxDocumentBytes: 1024,
        logger,
        expectedContentHash: 'stale-hash',
      }),
    ).resolves.toEqual({ committed: false, staleContent: true });
    expect(query.mock.calls.map(([statement]) => String(statement).toLowerCase())).toEqual([
      'begin',
      expect.stringContaining('from pages where id = $1 for update'),
      'rollback',
    ]);
    expect(client.release).toHaveBeenCalledOnce();
    document.destroy();
  });

  it('rolls back oversized canonical state with a typed error', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ ydoc: null, title: 'Page', is_deleted: false, title_revision: '1' }],
      })
      .mockResolvedValueOnce({ rows: [] });
    const { pool, client } = createPool(query);
    const document = new Y.Doc();
    document.getText('content').insert(0, 'content');

    await expect(
      persistDocument({
        pool,
        hocuspocus,
        documentName: 'page-1',
        document,
        connectionSnapshotState: Y.encodeStateAsUpdate(document),
        connectionResolutionPrincipals: [],
        lastCanonicalTitle: 'Page',
        getPendingTitleBaseline: () => undefined,
        maxDocumentBytes: 1,
        logger,
        expectedContentHash: undefined,
      }),
    ).rejects.toBeInstanceOf(DocumentSizeLimitError);
    expect(client.release).toHaveBeenCalledOnce();
    document.destroy();
  });

  it('retains typed content metadata across a deadlock retry', async () => {
    let deadlocked = false;
    const metadataUpdates: unknown[][] = [];
    const query = vi.fn(async (statement: unknown, values?: unknown[]) => {
      const text = String(statement).toLowerCase();
      if (text.includes('from pages where id = $1 for update')) {
        return {
          rows: [
            {
              ydoc: null,
              title: 'Page',
              icon: null,
              properties: null,
              is_deleted: false,
              title_revision: '1',
            },
          ],
        };
      }
      if (text.startsWith('update pages set ydoc') && !deadlocked) {
        deadlocked = true;
        throw Object.assign(new Error('deadlock'), { code: '40P01' });
      }
      if (text.includes('update pages set properties')) metadataUpdates.push(values ?? []);
      if (text.includes('select coalesce(get_root_folder_owner')) {
        return { rows: [{ owner_id: 'user-1', properties: { tags: ['retry'] } }] };
      }
      if (text.includes('select title, icon, parent_id, position')) {
        return { rows: [{ title: 'Page', icon: 'pin', parent_id: null, position: '0' }] };
      }
      return { rows: [] };
    });
    const clients = [
      { query, release: vi.fn() } as unknown as PoolClient,
      { query, release: vi.fn() } as unknown as PoolClient,
    ];
    const pool = {
      connect: vi.fn().mockResolvedValueOnce(clients[0]).mockResolvedValueOnce(clients[1]),
    } as unknown as Pool;
    const document = new Y.Doc();
    document.getText('content').insert(0, 'content');

    await expect(
      persistDocument({
        pool,
        hocuspocus,
        documentName: 'page-1',
        document,
        connectionSnapshotState: Y.encodeStateAsUpdate(document),
        connectionResolutionPrincipals: [],
        lastCanonicalTitle: 'Page',
        getPendingTitleBaseline: () => undefined,
        maxDocumentBytes: 1024,
        logger,
        expectedContentHash: undefined,
        mutation: {
          expectedMetadataHash: contentMetadataHash({ properties: null, icon: null }),
          metadata: { properties: { tags: ['retry'] }, icon: 'pin' },
        },
      }),
    ).resolves.toMatchObject({ committed: true });
    expect(metadataUpdates).toEqual([[JSON.stringify({ tags: ['retry'] }), 'pin', 'page-1']]);
    expect(clients[0]?.release).toHaveBeenCalledOnce();
    expect(clients[1]?.release).toHaveBeenCalledOnce();
    document.destroy();
  });
});
