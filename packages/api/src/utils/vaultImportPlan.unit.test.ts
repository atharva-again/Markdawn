import { describe, expect, it } from 'vitest';
import { createVaultImportPlan } from './vaultImportPlan';

describe('vault import plan', () => {
  it('keeps only supported inputs when valid candidates are present', () => {
    const plan = createVaultImportPlan([
      { path: 'attachments/archive.pdf' },
      { path: 'notes/Note.md', content: '# Note' },
      { path: 'images/photo.png', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
    ]);

    expect(plan.files.map((file) => file.path)).toEqual(['notes/Note.md', 'images/photo.png']);
    expect(plan.markdownFiles.map((file) => file.path)).toEqual(['notes/Note.md']);
    expect(plan.imageFiles.map((file) => file.path)).toEqual(['images/photo.png']);
  });

  it('separates unsupported image candidates without validating the typed input', () => {
    const plan = createVaultImportPlan([
      { path: 'notes/Note.md', content: '# Note' },
      { path: 'images/diagram.svg', data: 'PHN2Zy8+', mimeType: 'image/svg+xml' },
    ]);

    expect(plan.files.map((file) => file.path)).toEqual(['notes/Note.md']);
    expect(plan.unsupportedImageFiles.map((file) => file.path)).toEqual(['images/diagram.svg']);
  });
});
