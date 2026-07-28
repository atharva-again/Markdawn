import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const collaboration = vi.hoisted(() => ({
  readPageMarkdown: vi.fn(),
  replacePageMarkdown: vi.fn(),
}));

vi.mock('../../middleware/v1Auth', () => ({
  requireV1Scope: () => async (_context: unknown, next: () => Promise<void>) => next(),
}));
vi.mock('../../utils/collaborationContentClient', () => collaboration);

import pageContentRoute from './pageContent';

describe('v1 page content', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects malformed UTF-8 Markdown without forwarding a replacement', async () => {
    const app = new Hono();
    app.route('/pages', pageContentRoute);

    const response = await app.request(`/pages/${randomUUID()}/content`, {
      method: 'PUT',
      headers: { 'If-Match': '"current"', 'Content-Type': 'text/markdown' },
      body: new Uint8Array([0xc3, 0x28]),
    });

    expect(response.status).toBe(400);
    expect(collaboration.replacePageMarkdown).not.toHaveBeenCalled();
  });
});
