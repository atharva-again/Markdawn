import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';
import { isUnknownIdempotencyOutcome, parseIdempotencyKey } from './idempotency';

describe('parseIdempotencyKey', () => {
  it('allows an absent header', () => {
    expect(parseIdempotencyKey(undefined)).toBeNull();
  });

  it.each(['', '   ', '\t\r\n'])('rejects a present blank header', (value) => {
    expect(() => parseIdempotencyKey(value)).toThrowError(
      expect.objectContaining<Partial<HTTPException>>({ status: 400 }),
    );
  });

  it('trims and returns a valid key', () => {
    expect(parseIdempotencyKey('  retry-key  ')).toBe('retry-key');
  });
});

describe('isUnknownIdempotencyOutcome', () => {
  it('distinguishes rejected admission from genuinely uncertain 503 responses', () => {
    expect(
      isUnknownIdempotencyOutcome(
        new HTTPException(503, { cause: { code: 'collaboration_busy' } }),
      ),
    ).toBe(false);
    expect(
      isUnknownIdempotencyOutcome(
        new HTTPException(503, { cause: { code: 'COLLABORATION_FAILURE' } }),
      ),
    ).toBe(true);
  });
});
