import { describe, expect, it } from 'vitest';
import { testQuery as query } from '../../db/testQuery';
import {
  createTestApp,
  createTestFolder,
  createTestPage,
  createTestSession,
  createTestUser,
} from '../../test-utils';

describe('v1 page title search', () => {
  it('requires authentication', async () => {
    const app = await createTestApp();

    const response = await app.request('/api/v1/pages/search?q=notes');

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: 'unauthorized', message: 'Unauthorized' },
    });
  });

  it('returns accessible pages whose titles match the query', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);
    const folder = await createTestFolder(user.id, { name: 'Research' });
    const matchingPage = await createTestPage(user.id, {
      title: 'Project Notes',
      parentId: folder.id,
    });
    await createTestPage(user.id, { title: 'Shopping List' });

    const response = await app.request('/api/v1/pages/search?q=project', {
      headers: session,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [
        {
          id: matchingPage.id,
          title: 'Project Notes',
          parentId: folder.id,
          folderPath: '/Research',
        },
      ],
    });
  });

  it('uses full-text stemming for title matches', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);
    const page = await createTestPage(user.id, { title: 'Universities' });
    await query("UPDATE pages SET title_search = to_tsvector('english', title) WHERE id = $1", [
      page.id,
    ]);

    const response = await app.request('/api/v1/pages/search?q=university', {
      headers: session,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [{ id: page.id, title: 'Universities' }],
    });
  });

  it('does not return deleted or inaccessible pages', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const otherUser = await createTestUser();
    const session = await createTestSession(user.id);
    const deletedPage = await createTestPage(user.id, { title: 'Deleted Notes' });
    await createTestPage(otherUser.id, { title: 'Private Notes' });
    await app.request(`/api/pages/${deletedPage.id}`, {
      method: 'DELETE',
      headers: { ...session, Origin: 'http://localhost:5173' },
    });

    const response = await app.request('/api/v1/pages/search?q=notes', {
      headers: session,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [] });
  });

  it('returns no results for a blank query', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);
    await createTestPage(user.id, { title: 'Notes' });

    const response = await app.request('/api/v1/pages/search?q=', {
      headers: session,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [] });
  });
});
