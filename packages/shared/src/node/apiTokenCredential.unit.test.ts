import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseApiTokenCredential } from './apiTokenCredential';

describe('parseApiTokenCredential', () => {
  it('extracts the token ID and hashes the complete secret', () => {
    const token = `mdn_00112233445566778899aabbccddeeff_${'a'.repeat(43)}`;
    expect(parseApiTokenCredential(token)).toEqual({
      id: '00112233-4455-6677-8899-aabbccddeeff',
      hash: createHash('sha256').update(token).digest('hex'),
    });
  });

  it('rejects malformed tokens', () => {
    expect(parseApiTokenCredential('session-token')).toBeNull();
  });
});
