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

export const createPageRequestSchema = z.object({
  title: z.string({ error: 'title must be a string' }).optional(),
  parentId: uuid.nullable().optional(),
  icon: z.string({ error: 'icon must be a string' }).nullable().optional(),
  markdown: z.string({ error: 'markdown must be a string' }).optional(),
});

export const updatePageRequestSchema = z
  .object({
    title: z.string({ error: 'title must be a string' }).optional(),
    icon: z.string({ error: 'icon must be a string or null' }).nullable().optional(),
  })
  .refine((request) => request.title !== undefined || request.icon !== undefined, {
    message: 'No supported fields were provided',
  });

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
const etagHeader = { ETag: { schema: { type: 'string' } } } as const;

export const pageOperations = {
  list: {
    method: 'get',
    routePath: '/',
    openApiPath: '/pages',
    summary: 'List accessible pages',
    parameters: [
      { name: 'cursor', in: 'query', schema: { type: 'string' } },
      { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
      { name: 'parentId', in: 'query', schema: { type: 'string', format: 'uuid' } },
    ],
    responses: {
      '200': {
        description: 'Cursor-paginated page list',
        content: jsonContent(pageListResponseSchema),
      },
    },
  },
  resolveTitle: {
    method: 'get',
    routePath: '/resolve',
    openApiPath: '/pages/resolve',
    summary: 'Resolve an exact page title with server-computed folder paths',
    parameters: [
      { name: 'title', in: 'query', required: true, schema: { type: 'string', maxLength: 250 } },
    ],
    responses: {
      '200': {
        description: 'Permission-filtered exact-title matches',
        content: jsonContent(pageResolutionResponseSchema),
      },
    },
  },
  create: {
    method: 'post',
    routePath: '/',
    openApiPath: '/pages',
    summary: 'Create a page with optional initial Markdown',
    request: { required: true, ...jsonContent(createPageRequestSchema) },
    responses: {
      '201': { description: 'Created page', content: jsonContent(pageResponseSchema) },
    },
  },
  get: {
    method: 'get',
    routePath: '/:id',
    openApiPath: '/pages/{pageId}',
    summary: 'Get page metadata',
    parameters: [pageIdParameter],
    responses: {
      '200': { description: 'Page metadata', content: jsonContent(pageResponseSchema) },
    },
  },
  update: {
    method: 'patch',
    routePath: '/:id',
    openApiPath: '/pages/{pageId}',
    summary: 'Update basic page metadata',
    parameters: [pageIdParameter],
    request: { required: true, ...jsonContent(updatePageRequestSchema) },
    responses: {
      '200': { description: 'Updated page', content: jsonContent(pageResponseSchema) },
    },
  },
  readContent: {
    method: 'get',
    routePath: '/:id/content',
    openApiPath: '/pages/{pageId}/content',
    summary: 'Read Markdown content',
    parameters: [pageIdParameter],
    responses: {
      '200': {
        description: 'Frontmatter and authored Markdown body',
        headers: etagHeader,
        content: markdownContent(z.string()),
      },
    },
  },
  replaceContent: {
    method: 'put',
    routePath: '/:id/content',
    openApiPath: '/pages/{pageId}/content',
    summary: 'Guarded whole-Markdown replacement',
    parameters: [
      pageIdParameter,
      { name: 'If-Match', in: 'header', required: true, schema: { type: 'string' } },
    ],
    request: { required: true, ...markdownContent(z.string()) },
    responses: {
      '204': { description: 'Content replaced', headers: etagHeader },
      '409': { description: 'Page revision conflict' },
      '428': { description: 'If-Match required' },
    },
  },
  editContent: {
    method: 'post',
    routePath: '/:id/edits',
    openApiPath: '/pages/{pageId}/edits',
    summary: 'Apply independent exact Markdown replacements',
    parameters: [
      pageIdParameter,
      {
        name: 'Idempotency-Key',
        in: 'header',
        schema: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
        description:
          'Replay completed edit responses for 24 hours. Incomplete reservations expire after 5 minutes.',
      },
    ],
    request: { required: true, ...jsonContent(exactEditsRequestSchema) },
    responses: {
      '200': {
        description: 'One result per requested edit',
        headers: etagHeader,
        content: jsonContent(exactEditsResponseSchema),
      },
    },
  },
  boundaryContentOperation: {
    method: 'post',
    routePath: '/:id/content-operations',
    openApiPath: '/pages/{pageId}/content-operations',
    summary: 'Append or prepend Markdown against the latest page content',
    parameters: [
      pageIdParameter,
      {
        name: 'Idempotency-Key',
        in: 'header',
        schema: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
        description:
          'Replay completed operation responses for 24 hours. Incomplete reservations expire after 5 minutes.',
      },
    ],
    request: { required: true, ...jsonContent(contentBoundaryOperationSchema) },
    responses: {
      '200': {
        description: 'Markdown was appended or prepended',
        headers: etagHeader,
        content: jsonContent(contentBoundaryOperationResponseSchema),
      },
    },
  },
} as const satisfies Record<string, V1OperationContract>;
