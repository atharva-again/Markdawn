import { describe, expect, it } from 'vitest';
import type { CollabServerConfig } from './collabServerConfig';
import { createCollabServer } from './server';

describe('collaboration server configuration', () => {
  it.each([
    undefined,
    'use-a-different-random-secret-here',
  ])('rejects invalid internal secret %s before server construction', (internalSecret) => {
    expect(() => createCollabServer({ internalSecret } as unknown as CollabServerConfig)).toThrow(
      'COLLAB_INTERNAL_SECRET',
    );
  });
});
