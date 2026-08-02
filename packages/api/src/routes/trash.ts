import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { emptyTrashForUser } from '../utils/trashLifecycle';

const trashRoute = new Hono();
trashRoute.use('*', requireAuth);

trashRoute.delete('/empty-all', async (c) => {
  const user = c.get('user') as { id: string };
  const result = await emptyTrashForUser(user.id);

  return c.json({ deleted: true, folders: result.folders, pages: result.pages });
});

export default trashRoute;
