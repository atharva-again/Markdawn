import { describe, expect, it } from 'vitest';
import { getFileExtension } from './fileExtension';

describe('getFileExtension', () => {
  it.each([
    ['image.png', 'png'],
    ['IMAGE.PNG', 'png'],
    ['archive.tar.gz', 'gz'],
    ['README', ''],
    ['notes.v1/README', ''],
  ])('returns the lowercase extension for %s', (value, expected) => {
    expect(getFileExtension(value)).toBe(expected);
  });
});
