import { createMcpHandler } from '@modelcontextprotocol/server';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { actorFromAuthInfo, createMcpRequestAuthenticator } from './mcpAuth';
import { mcpCors } from './mcpCors';
import { registerMcpHealthRoutes } from './mcpHealth';
import { apiOrigin, mcpProxyBodyLimit, proxyToApi } from './mcpProxy';
import { createMcpServer } from './server';
import { V1Client } from './v1Client';

export type McpAppOptions = {
  apiUrl: string;
  publicUrl: URL;
  authIssuer?: string;
  authJwksUrl?: string;
  apiInternalSecret: string;
  fetcher?: typeof fetch;
};

const MCP_MESSAGE_MAX_BODY_BYTES = 32 * 1024 * 1024;
const mcpMessageBodyLimit = bodyLimit({
  maxSize: MCP_MESSAGE_MAX_BODY_BYTES,
  onError: (c) =>
    c.json({ error: { code: 'payload_too_large', message: 'MCP request body is too large' } }, 413),
});

export function createMcpApp(options: McpAppOptions): Hono {
  const app = new Hono();
  const publicUrl = options.publicUrl;
  const upstreamApi = apiOrigin(options.apiUrl);
  const fetcher = options.fetcher ?? fetch;
  const clientOptions = {
    baseUrl: new URL('/api/v1', upstreamApi).toString(),
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
  };
  const resource = new URL('/mcp', publicUrl).toString();
  const authIssuer = options.authIssuer ?? 'http://localhost:5173/api/auth';
  const authJwksUrl = options.authJwksUrl ?? `${authIssuer}/jwks`;
  const mcpHandler = createMcpHandler(
    ({ authInfo }) => {
      if (!authInfo) throw new Error('MCP authentication info missing');
      const actor = actorFromAuthInfo({
        ...authInfo,
        apiInternalSecret: options.apiInternalSecret,
      });
      return createMcpServer(new V1Client({ ...clientOptions, actor }));
    },
    { legacy: 'reject' },
  );
  const handleMcpRequest = createMcpRequestAuthenticator(
    {
      authIssuer,
      authJwksUrl,
      publicUrl,
      resource,
    },
    mcpHandler,
  );

  registerMcpHealthRoutes(app, upstreamApi, fetcher);
  // Keep the health routes ahead of the existing CORS middleware. Hono applies
  // middleware in registration order, so moving CORS above these routes would
  // change their response headers during a decomposition-only refactor.
  app.use('*', mcpCors);

  const proxyToAuth = (c: Context) => proxyToApi(c, upstreamApi, fetcher, '/api/auth');
  const proxyToApiRoot = (c: Context) => proxyToApi(c, upstreamApi, fetcher, '');
  app.all('/.well-known/oauth-protected-resource', mcpProxyBodyLimit, proxyToApiRoot);
  app.all('/.well-known/oauth-protected-resource/mcp', mcpProxyBodyLimit, proxyToApiRoot);
  app.all('/.well-known/*', mcpProxyBodyLimit, proxyToAuth);
  app.all('/oauth2/*', mcpProxyBodyLimit, proxyToAuth);
  app.all('/jwks', mcpProxyBodyLimit, proxyToAuth);

  app.post('/mcp', mcpMessageBodyLimit, async (c) => handleMcpRequest(c.req.raw));

  app.notFound((c) => c.json({ message: 'Not Found' }, 404));
  return app;
}
