import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decodeResourceCursor, encodeResourceCursor, parseResourceLimit } from './resourceCursor';

describe('resource cursors', () => {
  it('round-trips PostgreSQL microsecond timestamps', () => {
    const row = { id: randomUUID(), cursor_updated_at: '2026-07-26T12:34:56.123456' };
    expect(decodeResourceCursor(encodeResourceCursor(row))).toEqual({
      id: row.id,
      updatedAt: row.cursor_updated_at,
    });
  });

  it('rejects non-canonical base64url input', () => {
    const cursor = encodeResourceCursor({
      id: randomUUID(),
      cursor_updated_at: '2026-07-26T12:34:56.123456',
    });
    expect(() => decodeResourceCursor(`${cursor}!`)).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });
});

describe('parseResourceLimit', () => {
  it('applies the default and validates the shared pagination range', () => {
    expect(parseResourceLimit(undefined)).toBe(50);
    expect(parseResourceLimit('100')).toBe(100);
    expect(() => parseResourceLimit('101')).toThrow(expect.objectContaining({ status: 400 }));
  });
});
