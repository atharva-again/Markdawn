import { describe, expect, it, vi } from 'vitest';
import { createMcpApp } from './routes';

type TestMcpHandler = {
  fetch: (request: Request, options?: unknown) => Promise<Response>;
};

vi.mock('./mcpAuth', () => ({
  actorFromAuthInfo: () => ({
    token: 'test-mcp-internal-credential',
    userId: '00000000-0000-4000-8000-000000000001',
    scopes: ['pages:read'],
  }),
  createMcpRequestAuthenticator:
    (_options: unknown, handler: TestMcpHandler) => (request: Request) =>
      handler.fetch(request, { authInfo: {} }),
}));

describe('legacy MCP protocol compatibility', () => {
  it('accepts a stateless 2025-era initialize request', async () => {
    const app = createMcpApp({
      apiUrl: 'https://api.example.test',
      publicUrl: new URL('https://mcp.example.test'),
      authIssuer: 'https://auth.example.test/api/auth',
      authJwksUrl: 'https://auth.example.test/api/auth/jwks',
      apiInternalSecret: 'test-mcp-api-internal-secret-0123456789',
      fetcher: vi.fn<typeof fetch>(),
    });

    const response = await app.request('/mcp', {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'legacy-test-client', version: '1.0.0' },
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('2025-06-18');
  });
});
