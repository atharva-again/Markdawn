import { describe, expect, it } from 'vitest';
import type { AuthenticatedCredential } from './authenticatedCredential';
import { authenticatedCredentialKey } from './authenticatedCredential';

describe('authenticated credentials', () => {
  it('treats every public credential as a browser session', () => {
    const session = { kind: 'session', raw: 'session-token' } satisfies AuthenticatedCredential;
    expect(authenticatedCredentialKey(session)).toBe('session:session-token');

    const token = `mdn_${'a'.repeat(32)}_${'b'.repeat(43)}`;
    expect(authenticatedCredentialKey({ kind: 'session', raw: token })).toBe(`session:${token}`);
  });

  it('keys trusted internal commands separately from browser sessions', () => {
    const credential = {
      kind: 'internal' as const,
      raw: 'request-id',
      tokenId: null,
      idempotencyPrincipal: 'session:hash',
    };
    expect(authenticatedCredentialKey(credential)).toBe('internal:request-id');
  });
});
