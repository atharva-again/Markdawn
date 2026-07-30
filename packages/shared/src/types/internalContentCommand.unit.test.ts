import { describe, expect, it } from 'vitest';
import { MAX_YDOC_BYTES } from '../constants/collaboration';
import {
  applyContentBoundaryOperationCommandSchema,
  applyExactEditsCommandSchema,
  exactEditCommandResponseSchema,
  exactEditsRequestSchema,
  MAX_CONTENT_BOUNDARY_OPERATION_ID_LENGTH,
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

  it('requires non-empty boundary-operation content', () => {
    expect(
      applyContentBoundaryOperationCommandSchema.safeParse({
        id: 'append',
        operation: 'append',
        content: '',
      }).success,
    ).toBe(false);
  });

  it('bounds boundary-operation content by UTF-8 byte length', () => {
    const operation = { id: 'append', operation: 'append' };
    expect(
      applyContentBoundaryOperationCommandSchema.safeParse({
        ...operation,
        content: 'x'.repeat(MAX_YDOC_BYTES),
      }).success,
    ).toBe(true);
    expect(
      applyContentBoundaryOperationCommandSchema.safeParse({
        ...operation,
        content: 'é'.repeat(Math.floor(MAX_YDOC_BYTES / 2) + 1),
      }).success,
    ).toBe(false);
  });

  it('bounds boundary-operation IDs', () => {
    const operation = { operation: 'append', content: 'Content' };
    expect(
      applyContentBoundaryOperationCommandSchema.safeParse({
        ...operation,
        id: 'a'.repeat(MAX_CONTENT_BOUNDARY_OPERATION_ID_LENGTH),
      }).success,
    ).toBe(true);
    expect(
      applyContentBoundaryOperationCommandSchema.safeParse({
        ...operation,
        id: 'a'.repeat(MAX_CONTENT_BOUNDARY_OPERATION_ID_LENGTH + 1),
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
