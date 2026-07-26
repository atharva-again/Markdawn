import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { query } from '../../db/query';
import { requireV1Auth, requireV1Scope } from '../../middleware/v1Auth';
import { jsonContent, type V1OperationContract } from './apiContract';
import {
  decodeResourceCursor,
  encodeResourceCursor,
  parseResourceLimit,
  type ResourceCursorRow,
} from './resourceCursor';

type FolderRow = {
  id: string;
  enumerable_parent_id: string | null;
  name: string;
  icon: string | null;
  owner_id: string | null;
  permission: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
} & ResourceCursorRow;

const folderResponseSchema = z.object({
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  name: z.string(),
  icon: z.string().nullable(),
  ownerId: z.uuid().nullable(),
  permission: z.enum(['view', 'edit', 'admin']).nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export const listFoldersOperation = {
  method: 'get',
  routePath: '/',
  openApiPath: '/folders',
  summary: 'List accessible folders',
  parameters: [
    { name: 'cursor', in: 'query', schema: { type: 'string' } },
    { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
  ],
  responses: {
    '200': {
      description: 'Flat folder list',
      content: jsonContent(
        z.object({ data: z.array(folderResponseSchema), nextCursor: z.string().nullable() }),
      ),
    },
  },
} as const satisfies V1OperationContract;

const foldersV1Route = new Hono();
foldersV1Route.use('*', requireV1Auth);
foldersV1Route.use('*', requireV1Scope('pages:read'));

foldersV1Route.get(listFoldersOperation.routePath, async (c) => {
  const principal = c.get('v1Principal');
  const cursor = decodeResourceCursor(c.req.query('cursor'));
  const parsedLimit = parseResourceLimit(c.req.query('limit'));
  const result = await query<FolderRow>(
    sql`select f.id, f.name, f.icon, f.created_at, f.updated_at,
        case
          when f.parent_id in (select folder_id from get_enumerable_folder_ids(${principal.userId}))
          then f.parent_id
          else null
        end as enumerable_parent_id,
        get_root_folder_owner(f.id) as owner_id, access.permission,
        to_char(
          coalesce(f.updated_at, f.created_at, 'epoch'::timestamp),
          'YYYY-MM-DD"T"HH24:MI:SS.US'
        ) as cursor_updated_at
      from folders f
      join lateral get_effective_folder_permission(f.id, ${principal.userId}) access on true
      where f.is_deleted = false
        and f.id in (select folder_id from get_enumerable_folder_ids(${principal.userId}))
        and access.permission is not null
        ${cursor ? sql`and (coalesce(f.updated_at, f.created_at, 'epoch'::timestamp), f.id) < (${cursor.updatedAt}::timestamp, ${cursor.id})` : sql``}
      order by coalesce(f.updated_at, f.created_at, 'epoch'::timestamp) desc, f.id desc
      limit ${parsedLimit + 1}`,
  );
  const hasMore = result.rows.length > parsedLimit;
  const rows = result.rows.slice(0, parsedLimit);
  const last = rows.at(-1);
  return c.json({
    data: rows.map((row) => ({
      id: row.id,
      parentId: row.enumerable_parent_id,
      name: row.name,
      icon: row.icon,
      ownerId: row.owner_id,
      permission: row.permission,
      createdAt: row.created_at === null ? null : new Date(row.created_at).toISOString(),
      updatedAt: row.updated_at === null ? null : new Date(row.updated_at).toISOString(),
    })),
    nextCursor: hasMore && last ? encodeResourceCursor(last) : null,
  });
});

export default foldersV1Route;
