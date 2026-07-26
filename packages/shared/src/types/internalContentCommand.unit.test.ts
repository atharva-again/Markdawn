import { describe, expect, it } from 'vitest';
import {
  applyExactEditsCommandSchema,
  exactEditCommandResponseSchema,
  exactEditsRequestSchema,
} from './internalContentCommand';

describe('internal content command codecs', () => {
  it('applies the same exact-edit uniqueness rules at public and internal boundaries', () => {
    const command = {
      edits: [
        { id: 'duplicate', oldText: 'one', newText: 'two' },
        { id: 'duplicate', oldText: 'three', newText: 'four' },
      ],
    };

    expect(exactEditsRequestSchema.safeParse(command).success).toBe(false);
    expect(applyExactEditsCommandSchema.safeParse(command).success).toBe(false);
  });

  it('validates the internal idempotency envelope', () => {
    expect(
      applyExactEditsCommandSchema.safeParse({
        edits: [{ id: 'edit', oldText: 'one', newText: 'two' }],
        idempotency: { recordId: 'not-a-uuid', key: '', requestHash: '' },
      }).success,
    ).toBe(false);
  });

  it('rejects response variants outside the shared result contract', () => {
    expect(
      exactEditCommandResponseSchema.safeParse({
        results: [{ id: 'edit', status: 'unknown' }],
        etag: 'etag',
      }).success,
    ).toBe(false);
  });
});
