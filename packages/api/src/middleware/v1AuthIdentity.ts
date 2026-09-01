import { sessionIdempotencyPrincipal } from '@markdawn/shared/node/api-token-credential';

export { mcpConnectionIdFromClaims } from '@markdawn/shared/node/mcp-internal-auth';

export function mcpIdempotencyPrincipal(connectionId: string): string {
  return sessionIdempotencyPrincipal(`mcp:${connectionId}`);
}
