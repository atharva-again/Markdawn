import { describe, expect, it } from 'vitest';
import { mcpConnectionIdFromClaims, mcpIdempotencyPrincipal } from './v1AuthIdentity';

describe('MCP OAuth idempotency identity', () => {
  it('keeps the same identity when a session access token is refreshed', () => {
    const first = mcpConnectionIdFromClaims('user-1', {
      sid: 'session-1',
      client_id: 'client-1',
      jti: 'access-token-1',
    });
    const refreshed = mcpConnectionIdFromClaims('user-1', {
      sid: 'session-1',
      client_id: 'client-1',
      jti: 'access-token-2',
    });

    expect(first).toBe('session:session-1:client:client-1:user:user-1');
    expect(refreshed).toBe(first);
    expect(mcpIdempotencyPrincipal(refreshed)).toBe(mcpIdempotencyPrincipal(first));
  });

  it('falls back to the stable user/client pair when no session claim exists', () => {
    expect(mcpConnectionIdFromClaims('user-1', { client_id: 'client-1', jti: 'token-1' })).toBe(
      'client:client-1:user:user-1',
    );
  });
});
