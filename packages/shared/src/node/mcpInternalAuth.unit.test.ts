import { describe, expect, it } from 'vitest';
import {
  createMcpInternalCredential,
  hashMcpAccessToken,
  MCP_API_DEVELOPMENT_SECRET,
  requireMcpApiInternalSecret,
  verifyMcpInternalCredential,
} from './mcpInternalAuth';

describe('MCP internal authentication', () => {
  it('round-trips signed user context without exposing the bearer token', () => {
    const token = 'oauth-token';
    const credential = createMcpInternalCredential(
      {
        userId: 'user-1',
        connectionId: 'connection-1',
        clientId: 'client-1',
        sessionId: 'session-1',
        accessTokenHash: hashMcpAccessToken(token),
        accessTokenExpiresAt: 1_060,
        offlineAccess: true,
        scopes: ['pages:read'],
      },
      'a'.repeat(32),
      1_000,
    );

    expect(credential).not.toContain(token);
    expect(verifyMcpInternalCredential(credential, 'a'.repeat(32), 1_001)).toMatchObject({
      userId: 'user-1',
      connectionId: 'connection-1',
      sessionId: 'session-1',
      accessTokenHash: hashMcpAccessToken(token),
      scopes: ['pages:read'],
    });
  });

  it('rejects tampering, the wrong secret, and expired context', () => {
    const credential = createMcpInternalCredential(
      {
        userId: 'user-1',
        connectionId: 'connection-1',
        clientId: null,
        sessionId: null,
        accessTokenHash: hashMcpAccessToken('oauth-token'),
        accessTokenExpiresAt: 1_060,
        offlineAccess: false,
        scopes: ['pages:read'],
      },
      'a'.repeat(32),
      1_000,
    );
    const [payload, signature] = credential.split('.');
    const tampered = `${payload}x.${signature}`;

    expect(verifyMcpInternalCredential(tampered, 'a'.repeat(32), 1_001)).toBeNull();
    expect(verifyMcpInternalCredential(credential, 'b'.repeat(32), 1_001)).toBeNull();
    expect(verifyMcpInternalCredential(credential, 'a'.repeat(32), 1_061)).toBeNull();
  });

  it('rejects the development secret only for production validation', () => {
    expect(requireMcpApiInternalSecret(MCP_API_DEVELOPMENT_SECRET)).toBe(
      MCP_API_DEVELOPMENT_SECRET,
    );
    expect(() => requireMcpApiInternalSecret(MCP_API_DEVELOPMENT_SECRET, true)).toThrow(
      'MCP_API_INTERNAL_SECRET must not use the development value in production',
    );
  });
});
