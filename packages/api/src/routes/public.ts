import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { pool } from '../db/connection';
import { requireAuth } from '../middleware/auth';

type PublicPageRow = {
  title: string;
  icon: string | null;
  coverType: string | null;
  coverValue: string | null;
  content: Uint8Array | null;
};

const publicRoute = new Hono();

publicRoute.get('/public/:token', async (c) => {
  const token = c.req.param('token');

  if (!token) {
    throw new HTTPException(400, { message: 'token is required' });
  }

  const result = await pool.query(
    'select title, icon, cover_type as "coverType", cover_value as "coverValue", ydoc as content from pages where public_token = $1 and is_public = true and is_deleted = false limit 1',
    [token],
  );

  const row = result.rows[0] as PublicPageRow | undefined;

  if (!row) {
    throw new HTTPException(404, { message: 'Page not found' });
  }

  return c.json({
    title: row.title,
    icon: row.icon,
    coverType: row.coverType,
    coverValue: row.coverValue,
    content: row.content ? Array.from(row.content) : null,
  });
});

// Require auth for all other routes
const publicShareRoute = new Hono();
publicShareRoute.use('*', requireAuth);

// POST /:pageId/share - Enable public sharing
publicShareRoute.post(':pageId/share', async (c) => {
  const pageId = c.req.param('pageId');
  const user = c.get('user') as { id: string };

  // Get page and verify ownership/membership
  const pageResult = await pool.query(
    'SELECT p.id, p.workspace_id, p.is_public, p.public_token FROM pages p WHERE p.id = $1',
    [pageId],
  );

  if (pageResult.rowCount === 0) {
    throw new HTTPException(404, { message: 'Page not found' });
  }

  const page = pageResult.rows[0];

  // Check workspace membership
  const memberResult = await pool.query(
    'SELECT id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
    [page.workspace_id, user.id],
  );

  if (memberResult.rowCount === 0) {
    throw new HTTPException(403, { message: 'Forbidden' });
  }

  // Generate or use existing token
  const publicToken = page.public_token || crypto.randomUUID();

  await pool.query(
    'UPDATE pages SET is_public = true, public_token = $1, updated_at = NOW() WHERE id = $2',
    [publicToken, pageId],
  );

  return c.json({
    isPublic: true,
    publicToken,
    shareUrl: `/public/${publicToken}`,
  });
});

// DELETE /:pageId/share - Disable public sharing
publicShareRoute.delete(':pageId/share', async (c) => {
  const pageId = c.req.param('pageId');
  const user = c.get('user') as { id: string };

  const pageResult = await pool.query('SELECT p.id, p.workspace_id FROM pages p WHERE p.id = $1', [
    pageId,
  ]);

  if (pageResult.rowCount === 0) {
    throw new HTTPException(404, { message: 'Page not found' });
  }

  const page = pageResult.rows[0];

  const memberResult = await pool.query(
    'SELECT id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
    [page.workspace_id, user.id],
  );

  if (memberResult.rowCount === 0) {
    throw new HTTPException(403, { message: 'Forbidden' });
  }

  await pool.query('UPDATE pages SET is_public = false, updated_at = NOW() WHERE id = $1', [
    pageId,
  ]);

  return c.json({ isPublic: false });
});

export { publicRoute, publicShareRoute };
