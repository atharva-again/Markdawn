import { describe, expect, it, vi } from 'vitest';
import type { McpActor, McpPage } from './types';
import { V1PageClient } from './v1ClientPages';
import type { V1ClientIO } from './v1ClientTransport';

const actor: McpActor = {
  token: 'internal-token',
  userId: '00000000-0000-4000-8000-000000000001',
  scopes: ['pages:read', 'pages:write'],
};

function page(updatedAt: string): McpPage {
  return {
    id: '00000000-0000-4000-8000-000000000002',
    parentId: null,
    title: 'Updated title',
    icon: null,
    cover: null,
    properties: null,
    ownerId: actor.userId,
    permission: 'edit',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
  };
}

describe('V1PageClient', () => {
  it('returns fresh metadata after replacing page content', async () => {
    const initialPage = page('2026-01-01T00:00:00.000Z');
    const updatedPage = page('2026-01-01T00:01:00.000Z');
    const io = {
      send: vi
        .fn()
        .mockImplementation(async (_token: string, path: string, init?: { method?: string }) => {
          if (init?.method === 'PUT' || path.endsWith('/content')) {
            return new Response(null, { headers: { etag: 'etag-2' } });
          }
          return new Response(null);
        }),
      readJson: vi.fn().mockResolvedValueOnce(initialPage).mockResolvedValueOnce(updatedPage),
      readMutationJson: vi.fn(),
      readBytes: vi.fn(),
      readBinaryOrMarkdown: vi.fn(),
      discardResponse: vi.fn().mockResolvedValue(undefined),
    } as unknown as V1ClientIO;
    const client = new V1PageClient(io);

    await expect(client.replacePage(actor, initialPage.id, 'new markdown')).resolves.toMatchObject({
      page: { updatedAt: updatedPage.updatedAt },
      changed: true,
      etag: 'etag-2',
    });
    expect(io.send).toHaveBeenCalledTimes(4);
    expect(io.send).toHaveBeenLastCalledWith(
      actor.token,
      `/pages/${initialPage.id}`,
      {},
      undefined,
    );
  });
});
