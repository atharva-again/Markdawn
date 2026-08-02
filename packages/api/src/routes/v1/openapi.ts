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
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: { code: { type: 'string' }, message: { type: 'string' } },
    },
  },
};

export const openApiV1 = {
  openapi: '3.1.0',
  info: {
    title: 'Markdawn API',
    version: '1.0.0',
    description: 'Client-neutral API for Markdawn pages and collaborative Markdown editing.',
  },
  servers: [{ url: '/api/v1' }],
  components: {
    securitySchemes: {
      bearerToken: { type: 'http', scheme: 'bearer', bearerFormat: 'Markdawn API token' },
      browserSession: { type: 'apiKey', in: 'cookie', name: 'better-auth.session_token' },
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
