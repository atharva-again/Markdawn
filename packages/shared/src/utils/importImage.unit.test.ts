import { describe, expect, it } from 'vitest';
import { isSupportedImportImageExtension, isSupportedImportImagePath } from './importImage';

describe('import image extensions', () => {
  it('recognizes supported image file extensions', () => {
    expect(isSupportedImportImageExtension('PNG')).toBe(true);
    expect(isSupportedImportImagePath('images/photo.PNG')).toBe(true);
  });

  it('does not treat a bare extension as an image path', () => {
    expect(isSupportedImportImagePath('png')).toBe(false);
  });
});
