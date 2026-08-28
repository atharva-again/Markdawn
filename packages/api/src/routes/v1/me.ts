import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { query } from '../../db/query';
import { requireV1Auth } from '../../middleware/v1Auth';
import { getMeOperation } from './meContract';

export { getMeOperation } from './meContract';

const meV1Route = new Hono();
meV1Route.use('*', requireV1Auth);

meV1Route.get(getMeOperation.routePath, async (c) => {
  const principal = c.get('v1Principal');
  const result = await query<{ id: string; name: string; email: string; image: string | null }>(
    sql`select id, name, email, image from users where id = ${principal.userId} limit 1`,
  );
  const user = result.rows[0];
  if (!user) throw new HTTPException(404, { message: 'User not found' });
  return c.json({
    ...user,
    authentication: principal.kind,
    scopes: principal.kind === 'session' ? null : [...principal.scopes],
  });
});

export default meV1Route;
