import { vi } from 'vitest';

// Unit tests exercise API modules without initializing Better Auth or its MCP
// resource database state. Auth-focused unit tests can replace this module per
// file; the integration project does not load this setup and uses real auth.
vi.mock('../src/auth', () => {
  const auth = {
    handler: vi.fn(async () => new Response(null, { status: 404 })),
    api: {
      getSession: vi.fn(async () => null),
    },
  };

  return {
    auth,
    createAuth: vi.fn(() => auth),
  };
});
