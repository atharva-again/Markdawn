import { describe, expect, it } from 'vitest';
import { requireCollaborationInternalSecret } from './collaborationSecret';

describe('requireCollaborationInternalSecret', () => {
  it.each([undefined, '', 'short'])('rejects missing or short secrets', (secret) => {
    expect(() => requireCollaborationInternalSecret(secret)).toThrow('COLLAB_INTERNAL_SECRET');
  });

  it.each([
    'replace-with-a-separate-random-secret',
    'use-a-different-random-secret-here',
  ])('rejects repository placeholder %s', (secret) => {
    expect(() => requireCollaborationInternalSecret(secret)).toThrow('repository placeholder');
  });

  it('returns a valid secret unchanged', () => {
    const secret = 'a'.repeat(32);
    expect(requireCollaborationInternalSecret(secret)).toBe(secret);
  });
});
