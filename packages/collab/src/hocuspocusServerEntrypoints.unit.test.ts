import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('Hocuspocus server entrypoints', () => {
  it('loads the ESM entrypoint', async () => {
    const server = await import('@hocuspocus/server');

    expect(typeof server.Hocuspocus).toBe('function');
  });

  it('loads the CommonJS entrypoint', () => {
    const server = require('@hocuspocus/server') as { Hocuspocus?: unknown };

    expect(typeof server.Hocuspocus).toBe('function');
  });
});
