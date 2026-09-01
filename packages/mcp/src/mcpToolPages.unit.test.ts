import { describe, expect, it } from 'vitest';
import { validateUpdatePageInput } from './mcpToolPages';

describe('update_page input validation', () => {
  it('rejects a request without a page mutation', () => {
    expect(() => validateUpdatePageInput({})).toThrow(
      'update_page requires title, icon, or clearIcon: true',
    );
  });

  it('accepts each supported page mutation', () => {
    expect(() => validateUpdatePageInput({ title: 'Renamed' })).not.toThrow();
    expect(() => validateUpdatePageInput({ icon: null })).not.toThrow();
    expect(() => validateUpdatePageInput({ clearIcon: true })).not.toThrow();
  });
});
