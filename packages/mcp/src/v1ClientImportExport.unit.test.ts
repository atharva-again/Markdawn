import { describe, expect, it } from 'vitest';
import { importFolderPreview } from './v1ClientImportExport';

describe('MCP import preview', () => {
  it('counts folders only for files accepted by the canonical import plan', () => {
    expect(
      importFolderPreview([
        { path: 'notes/readme.md', content: '# Readme' },
        { path: 'images/photo.png', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
        { path: 'unsupported/diagram.svg', data: 'PHN2Zy8+', mimeType: 'image/svg+xml' },
        { path: 'ignored/archive.pdf' },
      ]),
    ).toEqual({ notes: 1, images: 1, folders: 2 });
  });
});
