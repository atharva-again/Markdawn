import type { McpInternalAuthContext } from '@markdawn/shared/node/mcp-internal-auth';
import { verifyMcpInternalCredential } from '@markdawn/shared/node/mcp-internal-auth';
import { describe, expect, it } from 'vitest';
import { actorFromAuthInfo } from './mcpAuth';

const apiInternalSecret = 'test-mcp-api-internal-secret-0123456789';
const context: McpInternalAuthContext = {
  userId: '00000000-0000-4000-8000-000000000001',
  connectionId: 'session:session-1:client:client-1:user:user-1',
  clientId: 'client-1',
  sessionId: 'session-1',
  accessTokenHash: 'a'.repeat(64),
  accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 60,
  offlineAccess: false,
  scopes: ['pages:read'],
};

describe('MCP authentication context', () => {
  it('binds the API actor to the verified MCP context', () => {
    const actor = actorFromAuthInfo({
      apiInternalSecret,
      extra: { context },
    });

    expect(actor).toMatchObject({
      userId: context.userId,
      scopes: context.scopes,
    });
    expect(verifyMcpInternalCredential(actor.token, apiInternalSecret)).toMatchObject(context);
  });

  it('fails when the protected handler does not provide context', () => {
    expect(() => actorFromAuthInfo({ apiInternalSecret })).toThrow(
      'MCP authentication context is not an object',
    );
  });
});
