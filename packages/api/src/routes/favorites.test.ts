import { describe, expect, it } from 'vitest';
import { testQuery as query } from '../db/testQuery';
import {
  createTestApp,
  createTestFolder,
  createTestPage,
  createTestSession,
  createTestUser,
  createTestWorkspaceMember,
} from '../test-utils';

describe('favorites API', () => {
  describe('auth guard', () => {
    it('returns 401 without session cookie', async () => {
      const app = await createTestApp();
      const res = await app.request('/api/favorites');
      expect(res.status).toBe(401);
    });

    it('returns 401 with invalid session token', async () => {
      const app = await createTestApp();
      const res = await app.request('/api/favorites', {
        headers: { Cookie: 'better-auth.session_token=invalid-token' },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/favorites', () => {
    it('lists favorites for the user', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      await app.request('/api/favorites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ pageId: page.id }),
      });

      const res = await app.request(`/api/favorites`, {
        headers: { Cookie: session.Cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.favorites.length).toBeGreaterThanOrEqual(1);
    });

    it('preserves a direct source for a favorite page nested in a shared folder', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const recipient = await createTestUser();
      const recipientSession = await createTestSession(recipient.id);
      const sharedFolder = await createTestFolder(owner.id);
      const page = await createTestPage(owner.id, { parentId: sharedFolder.id });

      await query(
        `INSERT INTO shares (entity_type, entity_id, recipient_user_id, permission)
         VALUES ('folder', $1, $2, 'view'), ('page', $3, $2, 'view')`,
        [sharedFolder.id, recipient.id, page.id],
      );

      const addFavorite = await app.request('/api/favorites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: recipientSession.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ entityType: 'page', entityId: page.id }),
      });
      expect(addFavorite.status).toBe(201);

      const favorites = await app.request('/api/favorites', {
        headers: { Cookie: recipientSession.Cookie },
      });
      expect(favorites.status).toBe(200);
      const body = (await favorites.json()) as { favorites: Array<Record<string, unknown>> };
      expect(body.favorites).toContainEqual(
        expect.objectContaining({ entityId: page.id, shareSource: 'direct' }),
      );
    });

    it('preserves a public source for a favorite nested page with a public visit', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const visitor = await createTestUser();
      const visitorSession = await createTestSession(visitor.id);
      const publicFolder = await createTestFolder(owner.id);
      const page = await createTestPage(owner.id, { parentId: publicFolder.id });

      await query("UPDATE folders SET public_permission = 'view' WHERE id = $1", [publicFolder.id]);

      const folderVisit = await app.request(`/api/folders/${publicFolder.id}`, {
        headers: { Cookie: visitorSession.Cookie },
      });
      expect(folderVisit.status).toBe(200);

      const pageVisit = await app.request(`/api/pages/${page.id}`, {
        headers: { Cookie: visitorSession.Cookie },
      });
      expect(pageVisit.status).toBe(200);

      const addFavorite = await app.request('/api/favorites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: visitorSession.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ entityType: 'page', entityId: page.id }),
      });
      expect(addFavorite.status).toBe(201);

      const favorites = await app.request('/api/favorites', {
        headers: { Cookie: visitorSession.Cookie },
      });
      expect(favorites.status).toBe(200);
      const body = (await favorites.json()) as { favorites: Array<Record<string, unknown>> };
      expect(body.favorites).toContainEqual(
        expect.objectContaining({ entityId: page.id, shareSource: 'public' }),
      );

      const removeFromView = await app.request('/api/bulk-removal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: visitorSession.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({
          operations: [{ entityType: 'page', entityId: page.id, action: 'remove-from-view' }],
        }),
      });
      expect(removeFromView.status).toBe(200);
      expect(await removeFromView.json()).toMatchObject({
        removedFromViewCount: 1,
        failedItems: [],
      });
    });

    it('returns workspace when workspace access supersedes a direct grant', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const member = await createTestUser();
      const memberSession = await createTestSession(member.id);
      const page = await createTestPage(owner.id);
      await createTestWorkspaceMember(owner.id, member.id, 'viewer');
      await query(
        `INSERT INTO shares (entity_type, entity_id, recipient_user_id, permission)
         VALUES ('page', $1, $2, 'view')`,
        [page.id, member.id],
      );

      const addFavorite = await app.request('/api/favorites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: memberSession.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ entityType: 'page', entityId: page.id }),
      });
      expect(addFavorite.status).toBe(201);

      const favorites = await app.request('/api/favorites', {
        headers: { Cookie: memberSession.Cookie },
      });
      expect(favorites.status).toBe(200);
      const body = (await favorites.json()) as { favorites: Array<Record<string, unknown>> };
      expect(body.favorites).toContainEqual(
        expect.objectContaining({ entityId: page.id, shareSource: 'workspace' }),
      );
    });
  });

  describe('POST /api/favorites', () => {
    it('adds a page to favorites', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      const res = await app.request('/api/favorites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ pageId: page.id }),
      });

      expect(res.status).toBe(201);
    });

    it('adds a folder to favorites', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const folder = await createTestFolder(user.id, { name: 'Favorite Folder' });

      const res = await app.request('/api/favorites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ entityType: 'folder', entityId: folder.id }),
      });

      expect(res.status).toBe(201);

      const listRes = await app.request('/api/favorites', {
        headers: { Cookie: session.Cookie },
      });
      expect(listRes.status).toBe(200);
      const body = await listRes.json();
      expect(body.favorites).toContainEqual(
        expect.objectContaining({
          entityType: 'folder',
          entityId: folder.id,
          title: 'Favorite Folder',
        }),
      );
    });

    it('is idempotent (second favorite returns 200)', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      await app.request('/api/favorites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ pageId: page.id }),
      });

      const res = await app.request('/api/favorites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ pageId: page.id }),
      });

      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
    });

    it('returns 400 when pageId is missing', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/favorites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent page', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/favorites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ pageId: '00000000-0000-0000-0000-000000000000' }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/favorites/:pageId', () => {
    it('removes a page from favorites', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      await app.request('/api/favorites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ pageId: page.id }),
      });

      const res = await app.request(`/api/favorites/${page.id}`, {
        method: 'DELETE',
        headers: { Cookie: session.Cookie },
      });

      expect(res.status).toBe(200);
      expect((await res.json()).deleted).toBe(true);
    });

    it('returns 404 for non-existent page', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/favorites/00000000-0000-0000-0000-000000000000', {
        method: 'DELETE',
        headers: { Cookie: session.Cookie },
      });

      expect(res.status).toBe(404);
    });
  });
});
