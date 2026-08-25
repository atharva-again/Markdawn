import { cors } from 'hono/cors';

export const mcpCors = cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: [
    'Authorization',
    'Content-Type',
    'Accept',
    'If-Match',
    'Idempotency-Key',
    'mcp-session-id',
    'Last-Event-ID',
    'MCP-Protocol-Version',
    'Mcp-Method',
    'Mcp-Name',
  ],
  exposeHeaders: ['mcp-session-id', 'mcp-protocol-version', 'WWW-Authenticate'],
});
