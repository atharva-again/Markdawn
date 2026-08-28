import { hashMcpAccessToken } from '@markdawn/shared/node/mcp-internal-auth';
import { verifyBearerToken } from 'better-auth/oauth2';
import { sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { auth } from '../auth';
import { query } from '../db/query';
import { betterAuthIssuer, betterAuthJwksUrl, mcpResource } from '../env';
import {
  createMcpOAuthScopePolicy,
  MCP_OAUTH_MAX_REQUEST_BODY_BYTES,
  oversizedOAuthRequestResponse,
} from '../mcp/oauthScopePolicy';

const router = new Hono();

async function handleAuth(request: Request): Promise<Response> {
  return auth.handler(request);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function handleRevoke(c: Context): Promise<Response> {
  const body = new URLSearchParams(await c.req.raw.clone().text());
  const rawToken = body.get('token');
  const token = rawToken?.match(/^Bearer\s+(.+)$/i)?.[1] ?? rawToken;
  const response = await handleAuth(c.req.raw);
  if (!token || response.status !== 400) return response;

  const responseBody: unknown = await response.clone().json();
  if (!isRecord(responseBody) || responseBody.error !== 'unsupported_token_type') {
    return response;
  }

  const claims = await verifyBearerToken(token, {
    verifyOptions: { issuer: betterAuthIssuer(), audience: mcpResource() },
    jwksUrl: betterAuthJwksUrl(),
  });
  if (typeof claims.exp !== 'number' || !Number.isSafeInteger(claims.exp)) {
    throw new Error('Revoked JWT access token has no safe expiry');
  }
  await query(
    sql`insert into oauth_access_token_revocations (token_hash, expires_at)
        values (${hashMcpAccessToken(token)}, to_timestamp(${claims.exp}))
        on conflict (token_hash) do update set
          expires_at = excluded.expires_at,
        revoked_at = now()`,
  );
  return new Response(null, { status: 200 });
}

const mcpOAuthScopePolicy = createMcpOAuthScopePolicy(handleAuth);

const mcpOAuthBodyLimit = bodyLimit({
  maxSize: MCP_OAUTH_MAX_REQUEST_BODY_BYTES,
  onError: () => oversizedOAuthRequestResponse(),
});

router.use('/auth/*', mcpOAuthBodyLimit);

router.on(['GET', 'POST'], '/auth/oauth2/authorize', (c) =>
  mcpOAuthScopePolicy.authorize(c.req.raw),
);
router.post('/auth/oauth2/consent', (c) => mcpOAuthScopePolicy.consent(c.req.raw));
router.post('/auth/oauth2/revoke', handleRevoke);
router.on(['GET', 'POST'], '/auth/jwks', (c) => handleAuth(c.req.raw));
router.on(['GET', 'POST'], '/auth/oauth2/*', (c) => handleAuth(c.req.raw));
router.on(['GET', 'POST'], '/auth/*', (c) => handleAuth(c.req.raw));

export { router as authRoutes };
