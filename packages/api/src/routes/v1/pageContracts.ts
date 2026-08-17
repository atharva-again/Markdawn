import {
  type ContentBoundaryOperation,
  contentBoundaryOperationResponseSchema,
  contentBoundaryOperationSchema,
  type ExactEditCommandResponse,
  exactEditCommandResponseSchema,
  exactEditsRequestSchema,
} from '@markdawn/shared';
import { z } from 'zod';
import {
  jsonContent,
  markdownContent,
  uuidPathParameter,
  type V1OperationContract,
} from './apiContract';

const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid parentId');

export const createPageRequestSchema = z
  .object({
    title: z.string({ error: 'title must be a string' }).optional(),
    parentId: uuid.nullable().optional(),
    icon: z.string({ error: 'icon must be a string' }).nullable().optional(),
    markdown: z.string({ error: 'markdown must be a string' }).optional(),
  })
  .meta({
    example: {
      title: 'Project notes',
      markdown: '# Project notes\n\nStart writing here.',
    },
  });

export const updatePageRequestSchema = z
  .object({
    title: z.string({ error: 'title must be a string' }).optional(),
    icon: z.string({ error: 'icon must be a string or null' }).nullable().optional(),
  })
  .refine((request) => request.title !== undefined || request.icon !== undefined, {
    message: 'No supported fields were provided',
  })
  .meta({ example: { title: 'Updated project notes' } });

export { exactEditsRequestSchema };
export const exactEditsResponseSchema = exactEditCommandResponseSchema;
export { contentBoundaryOperationSchema };

export const pageResponseSchema = z.object({
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  title: z.string(),
  icon: z.string().nullable(),
  cover: z.object({ type: z.string(), value: z.string().nullable() }).nullable(),
  properties: z.record(z.string(), z.unknown()).nullable(),
  ownerId: z.uuid().nullable(),
  permission: z.enum(['view', 'edit', 'admin']).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const pageListResponseSchema = z.object({
  data: z.array(pageResponseSchema),
  nextCursor: z.string().nullable(),
});

export const pageResolutionResponseSchema = z.object({
  data: z.array(pageResponseSchema.extend({ folderPath: z.string() })),
});

export type CreatePageRequest = z.infer<typeof createPageRequestSchema>;
export type UpdatePageRequest = z.infer<typeof updatePageRequestSchema>;
export type ExactEditsRequest = z.infer<typeof exactEditsRequestSchema>;
export type ExactEditsResponse = ExactEditCommandResponse;
export type ContentBoundaryOperationRequest = ContentBoundaryOperation;
export type PageResponse = z.infer<typeof pageResponseSchema>;

const pageIdParameter = uuidPathParameter('pageId');
const etagHeader = {
  ETag: {
    description: 'Revision identifier for the returned page content.',
    schema: { type: 'string' },
  },
} as const;
const pagesTag = ['Pages'] as const;

export const pageOperations = {
  list: {
    method: 'get',
    routePath: '/',
    openApiPath: '/pages',
    summary: 'List Pages',
    description:
      'Returns non-deleted pages the caller can access, ordered by most recently updated. Use `parentId` to list pages directly inside a folder, and follow `nextCursor` until it is `null`.',
    tags: pagesTag,
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
        description: 'Number of pages to return. Defaults to 50 and cannot exceed 100.',
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      },
      {
        name: 'parentId',
        in: 'query',
        description: 'Return only pages directly inside this folder.',
        schema: { type: 'string', format: 'uuid' },
      },
    ],
    responses: {
      '200': {
        description: 'A page of accessible pages and the cursor for the next page.',
        content: jsonContent(pageListResponseSchema),
      },
    },
  },
  resolveTitle: {
    method: 'get',
    routePath: '/resolve',
    openApiPath: '/pages/resolve',
    summary: 'Find Pages By Exact Title',
    description:
      'Returns accessible, non-deleted pages whose titles match the `title` query without regard to case. Each result includes its computed folder path so duplicate titles can be distinguished.',
    tags: pagesTag,
    requiredScopes: ['pages:read'],
    parameters: [
      {
        name: 'title',
        in: 'query',
        required: true,
        description:
          'Title to match. Surrounding whitespace is ignored and matching is case-insensitive.',
        schema: { type: 'string', maxLength: 250 },
      },
    ],
    responses: {
      '200': {
        description: 'Accessible pages with matching titles and computed folder paths.',
        content: jsonContent(pageResolutionResponseSchema),
      },
    },
  },
  create: {
    method: 'post',
    routePath: '/',
    openApiPath: '/pages',
    summary: 'Create A Page',
    description:
      'Creates a page in the requested folder, or at the Markdawn root when `parentId` is omitted or `null`. You can include initial markdown in the request body.',
    tags: pagesTag,
    requiredScopes: ['pages:write'],
    request: { required: true, ...jsonContent(createPageRequestSchema) },
    responses: {
      '201': { description: 'Created page metadata.', content: jsonContent(pageResponseSchema) },
    },
  },
  get: {
    method: 'get',
    routePath: '/:id',
    openApiPath: '/pages/{pageId}',
    summary: 'Get Page Metadata',
    description:
      "Returns metadata for an accessible, non-deleted page. This response does not include the page's markdown body.",
    tags: pagesTag,
    requiredScopes: ['pages:read'],
    parameters: [pageIdParameter],
    responses: {
      '200': { description: 'Page metadata.', content: jsonContent(pageResponseSchema) },
    },
  },
  update: {
    method: 'patch',
    routePath: '/:id',
    openApiPath: '/pages/{pageId}',
    summary: 'Update Page Metadata',
    description:
      "Updates a page's title and/or icon. Include at least one supported field, and use a client with page write access.",
    tags: pagesTag,
    requiredScopes: ['pages:write'],
    parameters: [pageIdParameter],
    request: { required: true, ...jsonContent(updatePageRequestSchema) },
    responses: {
      '200': { description: 'Updated page metadata.', content: jsonContent(pageResponseSchema) },
    },
  },
  readContent: {
    method: 'get',
    routePath: '/:id/content',
    openApiPath: '/pages/{pageId}/content',
    summary: 'Read Page Content',
    description:
      "Returns the page's frontmatter and authored markdown body as `text/markdown`. The `ETag` response header identifies this version for a later conditional replacement.",
    tags: pagesTag,
    requiredScopes: ['pages:read'],
    parameters: [pageIdParameter],
    responses: {
      '200': {
        description: "The page's frontmatter and authored markdown body.",
        headers: etagHeader,
        content: markdownContent(z.string()),
      },
    },
  },
  replaceContent: {
    method: 'put',
    routePath: '/:id/content',
    openApiPath: '/pages/{pageId}/content',
    summary: 'Replace Page Content',
    description:
      'Replaces the complete markdown representation only when `If-Match` matches the current `ETag`. Read the page first, then reconcile and retry after a revision conflict.',
    tags: pagesTag,
    requiredScopes: ['pages:write'],
    parameters: [
      pageIdParameter,
      {
        name: 'If-Match',
        in: 'header',
        required: true,
        description: 'ETag returned when the current page content was read.',
        schema: { type: 'string' },
      },
    ],
    request: { required: true, ...markdownContent(z.string()) },
    responses: {
      '204': {
        description: 'Page content replaced. The new ETag is returned in the response headers.',
        headers: etagHeader,
      },
      '409': { description: 'If-Match did not match the current page revision.' },
      '428': { description: 'The If-Match header is required.' },
    },
  },
  editContent: {
    method: 'post',
    routePath: '/:id/edits',
    openApiPath: '/pages/{pageId}/edits',
    summary: 'Apply Exact Content Edits',
    description:
      'Replaces one or more exact passages without replacing the full page. Each old passage must occur exactly once, and missing or overlapping matches are rejected. Use `Idempotency-Key` when retrying the same request.',
    tags: pagesTag,
    requiredScopes: ['pages:write'],
    parameters: [
      pageIdParameter,
      {
        name: 'Idempotency-Key',
        in: 'header',
        schema: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
        description:
          'Use the same key to retry the same request. Completed responses are replayed for 24 hours; incomplete reservations expire after 5 minutes.',
      },
    ],
    request: { required: true, ...jsonContent(exactEditsRequestSchema) },
    responses: {
      '200': {
        description: 'One result for each requested edit and the new ETag.',
        headers: etagHeader,
        content: jsonContent(exactEditsResponseSchema),
      },
    },
  },
  boundaryContentOperation: {
    method: 'post',
    routePath: '/:id/content-operations',
    openApiPath: '/pages/{pageId}/content-operations',
    summary: 'Append Or Prepend Content',
    description:
      'Adds markdown at the beginning or end of the current page content. The operation runs against the latest content and returns the new `ETag`. Use `Idempotency-Key` when retrying the same request.',
    tags: pagesTag,
    requiredScopes: ['pages:write'],
    parameters: [
      pageIdParameter,
      {
        name: 'Idempotency-Key',
        in: 'header',
        schema: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
        description:
          'Use the same key to retry the same request. Completed responses are replayed for 24 hours; incomplete reservations expire after 5 minutes.',
      },
    ],
    request: { required: true, ...jsonContent(contentBoundaryOperationSchema) },
    responses: {
      '200': {
        description: 'Content was added and the new ETag is returned.',
        headers: etagHeader,
        content: jsonContent(contentBoundaryOperationResponseSchema),
      },
    },
  },
} as const satisfies Record<string, V1OperationContract>;
