import { Hono } from 'hono';
import { z } from 'zod';
import { buildOpenApiPaths } from './apiContract';
import { folderOperations } from './folders';
import { lifecycleOperations } from './lifecycleContracts';
import { getMeOperation } from './me';
import { pageOperations, pageResponseSchema } from './pageContracts';
import { tokenOperations } from './tokenContracts';

const pageResponseJsonSchema = z.toJSONSchema(pageResponseSchema);

const errorSchema = {
  type: 'object',
  description: 'Structured error returned when the request cannot be completed.',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      description: 'Error details for programmatic handling.',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string', description: 'Stable error code.' },
        message: { type: 'string', description: 'Human-readable explanation.' },
      },
    },
  },
};

export const openApiV1 = {
  openapi: '3.1.0',
  info: {
    title: 'Markdawn API',
    version: '1.0.0',
    description:
      'Read and change pages, folders, and markdown content through the same content layer used by Markdawn.',
  },
  tags: [
    {
      name: 'Identity',
      description: 'Read the authenticated user and authentication context.',
      'x-markdawn-docs-slug': 'identity',
    },
    {
      name: 'Pages',
      description: 'List, create, and update pages, including their markdown content.',
      'x-markdawn-docs-slug': 'pages',
    },
    {
      name: 'Folders',
      description: 'List, create, and update folders.',
      'x-markdawn-docs-slug': 'folders',
    },
    {
      name: 'Lifecycle',
      description: 'Copy, move, trash, restore, and permanently delete pages and folders.',
      'x-markdawn-docs-slug': 'lifecycle',
    },
    {
      name: 'Imports and Exports',
      description: 'Import markdown and Obsidian content, or export pages and accessible content.',
      'x-markdawn-docs-slug': 'imports-and-exports',
    },
    {
      name: 'API Tokens',
      description: 'Create, list, and revoke API tokens with a browser session.',
      'x-markdawn-docs-slug': 'api-tokens',
    },
  ],
  servers: [
    { url: 'https://app.markdawn.space/api/v1', description: 'Hosted Markdawn API' },
    { url: '/api/v1', description: 'Relative to the current Markdawn server.' },
  ],
  components: {
    securitySchemes: {
      bearerToken: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'Markdawn API token',
        description: 'Send a named API token in the Authorization header.',
      },
      browserSession: {
        type: 'apiKey',
        in: 'cookie',
        name: 'better-auth.session_token',
        description: 'Use the Better Auth session cookie from a signed-in browser session.',
      },
    },
    schemas: { Error: errorSchema, Page: pageResponseJsonSchema },
  },
  security: [{ bearerToken: [] }, { browserSession: [] }],
  paths: buildOpenApiPaths([
    getMeOperation,
    ...Object.values(pageOperations),
    ...Object.values(folderOperations),
    ...lifecycleOperations,
    ...Object.values(tokenOperations),
  ]),
} as const;

const openApiV1Route = new Hono();
openApiV1Route.get('/', (c) => c.json(openApiV1));

export default openApiV1Route;
