import {
  type ApiTokenAuditOperation,
  type ApiTokenAuditResult,
  type ApiTokenScope,
  getApiLogger,
  isApiTokenScope,
  parseApiTokenId,
} from '@markdawn/shared';
import {
  hashApiToken,
  sessionIdempotencyPrincipal,
  tokenIdempotencyPrincipal,
} from '@markdawn/shared/node/api-token-credential';
import { sql } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { auth } from '../auth';
import type { QueryExecutor } from '../db/query';
import { executeQuery, query } from '../db/query';

export type V1Principal =
  | { kind: 'session'; userId: string; credential: string }
  | {
      kind: 'token';
      userId: string;
      tokenId: string;
      credential: string;
      scopes: ReadonlySet<ApiTokenScope>;
    };

export function v1IdempotencyPrincipal(principal: V1Principal): string {
  return principal.kind === 'token'
    ? tokenIdempotencyPrincipal(principal.tokenId)
    : sessionIdempotencyPrincipal(principal.credential);
}

declare module 'hono' {
  interface ContextVariableMap {
    v1Principal: V1Principal;
  }
}

type TokenRow = {
  id: string;
  user_id: string;
  scopes: string[];
  last_used_at: Date | string | null;
};

const TOKEN_USAGE_UPDATE_INTERVAL_MS = 15 * 60 * 1000;

async function authenticateApiToken(token: string): Promise<V1Principal | null> {
  const tokenId = parseApiTokenId(token);
  if (!tokenId) return null;
  const result = await query<TokenRow>(
    sql`select id, user_id, scopes, last_used_at
        from api_tokens
        where id = ${tokenId}
          and token_hash = ${hashApiToken(token)}
          and revoked_at is null
          and (expires_at is null or expires_at > now())
        limit 1`,
  );
  const row = result.rows[0];
  if (!row) return null;
  const lastUsedAt = row.last_used_at === null ? null : new Date(row.last_used_at);
  if (lastUsedAt === null || lastUsedAt.getTime() <= Date.now() - TOKEN_USAGE_UPDATE_INTERVAL_MS) {
    await query(
      sql`update api_tokens set last_used_at = now()
          where id = ${row.id}
            and (last_used_at is null or last_used_at <= now() - interval '15 minutes')`,
    );
  }
  if (row.scopes.length === 0 || !row.scopes.every(isApiTokenScope)) {
    throw new Error(`API token ${row.id} has invalid scopes`);
  }
  const scopes = new Set<ApiTokenScope>(row.scopes);
  return { kind: 'token', userId: row.user_id, tokenId: row.id, credential: token, scopes };
}

export const requireV1Auth = createMiddleware(async (c, next) => {
  const logger = getApiLogger();
  const bearer = c.req
    .header('authorization')
    ?.match(/^Bearer\s+(.+)$/i)?.[1]
    ?.trim();
  if (bearer) {
    const principal = await authenticateApiToken(bearer);
    if (!principal) {
      logger.debug(`[v1:auth] invalid token: ${c.req.method} ${c.req.path}`);
      return c.json({ error: { code: 'unauthorized', message: 'Unauthorized' } }, 401);
    }
    c.set('v1Principal', principal);
    return next();
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const userId = session?.user?.id;
  const credential = session?.session?.token;
  if (!userId || !credential) {
    logger.debug(`[v1:auth] unauthenticated: ${c.req.method} ${c.req.path}`);
    return c.json({ error: { code: 'unauthorized', message: 'Unauthorized' } }, 401);
  }
  c.set('v1Principal', { kind: 'session', userId, credential });
  return next();
});

export function requireV1Scopes(scopes: readonly ApiTokenScope[]) {
  return createMiddleware(async (c, next) => {
    const principal = c.get('v1Principal');
    const missingScope =
      principal.kind === 'token' ? scopes.find((scope) => !principal.scopes.has(scope)) : undefined;
    if (missingScope) {
      return c.json(
        { error: { code: 'insufficient_scope', message: `Token requires ${missingScope}` } },
        403,
      );
    }
    return next();
  });
}

export function requireV1Scope(scope: ApiTokenScope) {
  return requireV1Scopes([scope]);
}

export function requireV1OperationScope(operation: { requiredScopes: readonly ApiTokenScope[] }) {
  return requireV1Scopes(operation.requiredScopes);
}

export const requireV1Session = createMiddleware(async (c, next) => {
  const principal = c.get('v1Principal');
  if (principal.kind !== 'session') {
    return c.json(
      { error: { code: 'session_required', message: 'A browser session is required' } },
      403,
    );
  }
  return next();
});

export async function recordTokenAuditEvent(
  principal: V1Principal,
  operation: ApiTokenAuditOperation,
  result: ApiTokenAuditResult,
  pageId: string | null,
  executor?: QueryExecutor,
): Promise<void> {
  if (principal.kind !== 'token') return;
  const statement = sql`insert into api_token_audit_events
    (token_id, owner_id, page_id, operation, result)
    values (${principal.tokenId}, ${principal.userId}, ${pageId}, ${operation}, ${result})`;
  if (executor) await executeQuery(executor, statement);
  else await query(statement);
}

/**
 * Lifecycle services commit before route-level token audit persistence.
 * Audit persistence is therefore an observability boundary: a failed insert is
 * logged but must not turn an already-completed, non-idempotent mutation into a
 * retry-unsafe error response.
 */
export async function recordTokenAuditEventBestEffort(
  principal: V1Principal,
  operation: ApiTokenAuditOperation,
  result: ApiTokenAuditResult,
  pageId: string | null,
): Promise<void> {
  try {
    await recordTokenAuditEvent(principal, operation, result, pageId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    getApiLogger().error('Failed to record API token audit event after lifecycle mutation', {
      operation,
      error: message,
    });
  }
}
