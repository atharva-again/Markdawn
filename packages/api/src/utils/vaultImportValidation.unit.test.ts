import { describe, expect, it } from 'vitest';
import { isCanonicalRelativeVaultPath, vaultImportRequestSchema } from './vaultImportValidation';

describe('vault import validation', () => {
  it('rejects invalid paths, duplicate paths, and requests without importable files', () => {
    expect(isCanonicalRelativeVaultPath('notes/Note.md')).toBe(true);
    expect(isCanonicalRelativeVaultPath('../Note.md')).toBe(false);
    expect(isCanonicalRelativeVaultPath('/Note.md')).toBe(false);
    expect(isCanonicalRelativeVaultPath('notes//Note.md')).toBe(false);
    expect(
      vaultImportRequestSchema.safeParse({ files: [{ path: 'notes/archive.pdf' }] }).success,
    ).toBe(false);
    expect(
      vaultImportRequestSchema.safeParse({
        files: [{ path: 'images/diagram.svg', data: 'PHN2Zy8+', mimeType: 'image/svg+xml' }],
      }).success,
    ).toBe(false);
    expect(
      vaultImportRequestSchema.safeParse({
        files: [
          { path: 'Note.md', content: '# First' },
          { path: 'Note.md', content: '# Second' },
        ],
      }).success,
    ).toBe(false);
  });
});
