import { API_TOKEN_SCOPES } from '@markdawn/shared';
import { z } from 'zod';
import { jsonContent, uuidPathParameter, type V1OperationContract } from './apiContract';

export const createTokenRequestSchema = z.object({
  name: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(100)),
  scopes: z.array(z.enum(API_TOKEN_SCOPES)).min(1).optional(),
  expiresAt: z.string().nullable().optional(),
});

export const apiTokenSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  scopes: z.array(z.enum(API_TOKEN_SCOPES)),
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const tokenOperations = {
  list: {
    method: 'get',
    routePath: '/',
    openApiPath: '/tokens',
    summary: 'List named API tokens',
    security: [{ browserSession: [] }],
    responses: {
      '200': {
        description: 'Tokens without secrets',
        content: jsonContent(z.object({ data: z.array(apiTokenSchema) })),
      },
    },
  },
  create: {
    method: 'post',
    routePath: '/',
    openApiPath: '/tokens',
    summary: 'Create a named API token',
    security: [{ browserSession: [] }],
    request: { required: true, ...jsonContent(createTokenRequestSchema) },
    responses: {
      '201': {
        description: 'Token secret shown once',
        content: jsonContent(apiTokenSchema.extend({ token: z.string() })),
      },
    },
  },
  revoke: {
    method: 'delete',
    routePath: '/:id',
    openApiPath: '/tokens/{tokenId}',
    summary: 'Revoke an API token',
    security: [{ browserSession: [] }],
    parameters: [uuidPathParameter('tokenId')],
    responses: { '204': { description: 'Token revoked' } },
  },
} as const satisfies Record<string, V1OperationContract>;
