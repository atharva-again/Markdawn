import { API_TOKEN_SCOPES } from '@markdawn/shared';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { query } from '../../db/query';
import { requireV1Auth } from '../../middleware/v1Auth';
import { jsonContent, type V1OperationContract } from './apiContract';

export const getMeOperation = {
  method: 'get',
  routePath: '/',
  openApiPath: '/me',
  summary: 'Get The Current User',
  description:
    "Returns the authenticated user's profile and how the request was authenticated. Token-authenticated responses include the token's scopes; session-authenticated responses set `scopes` to `null`.",
  tags: ['Identity'],
  requiredScopes: [],
  responses: {
    '200': {
      description: 'Current user and authentication context.',
      content: jsonContent(
        z.object({
          id: z.uuid(),
          name: z.string(),
          email: z.string(),
          image: z.string().nullable(),
          authentication: z.enum(['session', 'token']),
          scopes: z.array(z.enum(API_TOKEN_SCOPES)).nullable(),
        }),
      ),
    },
    '401': { description: 'Authentication failed or was not provided.' },
  },
} as const satisfies V1OperationContract;

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
    scopes: principal.kind === 'token' ? [...principal.scopes] : null,
  });
});

export default meV1Route;
