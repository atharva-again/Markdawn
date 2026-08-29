import type { Hono } from 'hono';

const MCP_API_READINESS_TIMEOUT_MS = 5_000;

async function apiIsReady(upstreamApi: URL, fetcher: typeof fetch): Promise<boolean> {
  try {
    const response = await fetcher(new URL('/api/health', upstreamApi), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(MCP_API_READINESS_TIMEOUT_MS),
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

export function registerMcpHealthRoutes(app: Hono, upstreamApi: URL, fetcher: typeof fetch): void {
  app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

  app.get('/api/ready', async (c) => {
    if (!(await apiIsReady(upstreamApi, fetcher))) {
      return c.json({ status: 'unavailable', dependency: 'api' }, 503);
    }
    return c.json({ status: 'ok', timestamp: Date.now() });
  });
}
