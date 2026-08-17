import { getUnicodeCodePointLength, MAX_FOLDER_NAME_LENGTH } from '@markdawn/shared';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { query } from '../../db/query';
import {
  recordTokenAuditEventBestEffort,
  requireV1Auth,
  requireV1OperationScope,
} from '../../middleware/v1Auth';
import { enumerableFolderPathsCte } from '../../utils/enumerableFolderPaths';
import {
  createFolderForActor,
  getFolderForUser,
  updateFolderForUser,
} from '../../utils/folderLifecycle';
import { jsonContent, uuidPathParameter, type V1OperationContract } from './apiContract';
import { v1JsonBodyLimit } from './requestLimits';
import { parseJsonRequest } from './requestValidation';
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

const uuidSchema = z.uuid();
export const createFolderRequestSchema = z
  .object({
    parentId: uuidSchema.nullable().optional(),
    name: z.string().optional(),
  })
  .strict()
  .meta({ example: { name: 'Project notes' } });
export const updateFolderRequestSchema = z
  .union(
    [
      z
        .object({
          name: z.string(),
          parentId: uuidSchema.nullable().optional(),
        })
        .strict(),
      z
        .object({
          name: z.string().optional(),
          parentId: uuidSchema.nullable(),
        })
        .strict(),
    ],
    {
      error: (issue) => {
        const { input } = issue;
        if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
          return Object.keys(input).length === 0 ? 'No supported fields were provided' : undefined;
        }
        return undefined;
      },
    },
  )
  .meta({ example: { name: 'Archived notes' } });

export const folderResponseSchema = z
  .object({
    id: z.uuid(),
    parentId: z.uuid().nullable(),
    name: z.string(),
    icon: z.string().nullable(),
    ownerId: z.uuid().nullable(),
    permission: z.enum(['view', 'edit', 'admin']).nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  .strict();

export type FolderResponse = z.infer<typeof folderResponseSchema>;

type FolderResponseInput = {
  id: string;
  parentId: string | null;
  name: string;
  icon: string | null;
  ownerId: string | null;
  permission: string | null | undefined;
  createdAt: Date | string | null | undefined;
  updatedAt: Date | string | null | undefined;
};

export function toFolderResponse(input: FolderResponseInput): FolderResponse {
  return {
    id: input.id,
    parentId: input.parentId,
    name: input.name,
    icon: input.icon,
    ownerId: input.ownerId,
    permission:
      input.permission === 'view' || input.permission === 'edit' || input.permission === 'admin'
        ? input.permission
        : null,
    createdAt:
      input.createdAt === null || input.createdAt === undefined
        ? null
        : new Date(input.createdAt).toISOString(),
    updatedAt:
      input.updatedAt === null || input.updatedAt === undefined
        ? null
        : new Date(input.updatedAt).toISOString(),
  };
}

const folderPathResponseSchema = folderResponseSchema.extend({ folderPath: z.string() }).strict();
const folderId = uuidPathParameter('folderId');
const foldersTag = ['Folders'] as const;

export const folderOperations = {
  create: {
    method: 'post',
    routePath: '/',
    openApiPath: '/folders',
    summary: 'Create A Folder',
    description:
      'Creates a folder in the requested parent, or at the Markdawn root when `parentId` is omitted or `null`.',
    tags: foldersTag,
    requiredScopes: ['pages:write'],
    request: { required: true, ...jsonContent(createFolderRequestSchema) },
    responses: {
      '201': {
        description: 'Created folder metadata.',
        content: jsonContent(folderResponseSchema),
      },
    },
  },
  resolve: {
    method: 'get',
    routePath: '/resolve',
    openApiPath: '/folders/resolve',
    summary: 'Find Folders By Exact Name',
    description:
      'Returns accessible, non-deleted folders whose names match the `name` query without regard to case. Each result includes its computed folder path.',
    tags: foldersTag,
    requiredScopes: ['pages:read'],
    parameters: [
      {
        name: 'name',
        in: 'query',
        required: true,
        description:
          'Folder name to match. Surrounding whitespace is ignored and matching is case-insensitive.',
        schema: { type: 'string', maxLength: 250 },
      },
    ],
    responses: {
      '200': {
        description: 'Accessible folders with matching names and computed folder paths.',
        content: jsonContent(z.object({ data: z.array(folderPathResponseSchema) }).strict()),
      },
    },
  },
  get: {
    method: 'get',
    routePath: '/:id',
    openApiPath: '/folders/{folderId}',
    summary: 'Get Folder Metadata',
    description: 'Returns metadata for an accessible, non-deleted folder.',
    tags: foldersTag,
    requiredScopes: ['pages:read'],
    parameters: [folderId],
    responses: {
      '200': { description: 'Folder metadata.', content: jsonContent(folderResponseSchema) },
    },
  },
  update: {
    method: 'patch',
    routePath: '/:id',
    openApiPath: '/folders/{folderId}',
    summary: 'Update Folder Metadata',
    description:
      'Updates a folder name, parent, or both. Set `parentId` to `null` to move the folder to the Markdawn root.',
    tags: foldersTag,
    requiredScopes: ['pages:write'],
    parameters: [folderId],
    request: { required: true, ...jsonContent(updateFolderRequestSchema) },
    responses: {
      '200': {
        description: 'Updated folder metadata.',
        content: jsonContent(folderResponseSchema),
      },
    },
  },
  list: {
    method: 'get',
    routePath: '/',
    openApiPath: '/folders',
    summary: 'List Folders',
    description:
      'Returns a cursor-paginated list of accessible, non-deleted folders. Follow `nextCursor` until it is `null`.',
    tags: foldersTag,
    requiredScopes: ['pages:read'],
    parameters: [
      {
        name: 'cursor',
        in: 'query',
        description: 'Cursor returned by a previous list response.',
        schema: { type: 'string' },
      },
      {
        name: 'limit',
        in: 'query',
        description: 'Number of folders to return. Defaults to 50 and cannot exceed 100.',
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      },
    ],
    responses: {
      '200': {
        description: 'A page of accessible folders and the cursor for the next page.',
        content: jsonContent(
          z
            .object({ data: z.array(folderResponseSchema), nextCursor: z.string().nullable() })
            .strict(),
        ),
      },
    },
  },
} as const satisfies Record<string, V1OperationContract>;

const foldersV1Route = new Hono();
foldersV1Route.use('*', requireV1Auth);

foldersV1Route.post(
  folderOperations.create.routePath,
  requireV1OperationScope(folderOperations.create),
  v1JsonBodyLimit,
  async (c) => {
    const principal = c.get('v1Principal');
    const request = await parseJsonRequest(c, createFolderRequestSchema);
    const created = await createFolderForActor(
      { kind: 'user', id: principal.userId },
      {
        parentId: request.parentId ?? null,
        ...(request.name === undefined ? {} : { name: request.name }),
      },
    );
    await recordTokenAuditEventBestEffort(principal, 'folder.lifecycle', 'success', null);
    return c.json(toFolderResponse({ ...created.folder, permission: created.permission }), 201);
  },
);

foldersV1Route.get(
  folderOperations.resolve.routePath,
  requireV1OperationScope(folderOperations.resolve),
  async (c) => {
    const principal = c.get('v1Principal');
    const name = c.req.query('name')?.trim();
    if (!name || getUnicodeCodePointLength(name) > MAX_FOLDER_NAME_LENGTH) {
      throw new HTTPException(400, {
        message: `name must be between 1 and ${MAX_FOLDER_NAME_LENGTH} characters`,
      });
    }
    const result = await query<
      FolderRow & { folder_path: string }
    >(sql`${enumerableFolderPathsCte(principal.userId)}
    select f.id, f.name, f.icon, f.created_at, f.updated_at,
      case when paths.id is null then null else f.parent_id end as enumerable_parent_id,
      get_root_folder_owner(f.id) as owner_id, access.permission,
      case when paths.path is null then '/' else '/' || paths.path end as folder_path
    from folders f
    join lateral get_effective_folder_permission(f.id, ${principal.userId}) access on true
    left join folder_paths paths on paths.id = f.id
    where f.is_deleted = false and lower(f.name) = lower(${name})
      and f.id in (select folder_id from get_enumerable_folder_ids(${principal.userId}))
      and access.permission is not null
    order by folder_path, f.id`);
    return c.json({
      data: result.rows.map((row) => ({
        ...toFolderResponse({
          id: row.id,
          parentId: row.enumerable_parent_id,
          name: row.name,
          icon: row.icon,
          ownerId: row.owner_id,
          permission: row.permission,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }),
        folderPath: row.folder_path,
      })),
    });
  },
);

foldersV1Route.get(
  folderOperations.get.routePath,
  requireV1OperationScope(folderOperations.get),
  async (c) => {
    const principal = c.get('v1Principal');
    const folderId = c.req.param('id');
    if (!uuidSchema.safeParse(folderId).success) {
      throw new HTTPException(400, { message: 'folder ID must be a UUID' });
    }
    const result = await getFolderForUser(folderId, principal.userId);
    return c.json(toFolderResponse({ ...result.folder, permission: result.permission }));
  },
);

foldersV1Route.patch(
  folderOperations.update.routePath,
  requireV1OperationScope(folderOperations.update),
  v1JsonBodyLimit,
  async (c) => {
    const principal = c.get('v1Principal');
    const folderId = c.req.param('id');
    if (!uuidSchema.safeParse(folderId).success) {
      throw new HTTPException(400, { message: 'folder ID must be a UUID' });
    }
    const request = await parseJsonRequest(c, updateFolderRequestSchema);
    const updated = await updateFolderForUser(folderId, principal.userId, request);
    await recordTokenAuditEventBestEffort(principal, 'folder.lifecycle', 'success', null);
    return c.json(toFolderResponse({ ...updated, permission: 'admin' }));
  },
);

foldersV1Route.get(
  folderOperations.list.routePath,
  requireV1OperationScope(folderOperations.list),
  async (c) => {
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
      data: rows.map((row) =>
        toFolderResponse({
          id: row.id,
          parentId: row.enumerable_parent_id,
          name: row.name,
          icon: row.icon,
          ownerId: row.owner_id,
          permission: row.permission,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }),
      ),
      nextCursor: hasMore && last ? encodeResourceCursor(last) : null,
    });
  },
);

export default foldersV1Route;
