import { describe, expect, it } from 'vitest';
import {
  lifecycleEntityResponseSchema,
  lifecycleFolderCopyResponseSchema,
  lifecyclePageTrashItemSchema,
  markdownImportRequestSchema,
  obsidianImportRequestSchema,
  parentRequestSchema,
} from './lifecycleContracts';

describe('v1 lifecycle contracts', () => {
  it('rejects browser-only page update fields', () => {
    expect(parentRequestSchema.safeParse({ parentId: null }).success).toBe(true);
    expect(parentRequestSchema.safeParse({ parentId: null, title: 'Browser only' }).success).toBe(
      false,
    );
  });

  it('strictly validates vault import files', () => {
    expect(
      obsidianImportRequestSchema.safeParse({ files: [{ path: 'Page.md', content: '# Page' }] })
        .success,
    ).toBe(true);
    expect(
      obsidianImportRequestSchema.safeParse({
        files: [{ path: 'Page.md', content: '# Page', browserOnly: true }],
      }).success,
    ).toBe(false);
    expect(
      obsidianImportRequestSchema.safeParse({ files: [{ path: 'Blank.md', content: '' }] }).success,
    ).toBe(true);
    expect(obsidianImportRequestSchema.safeParse({ files: [{ path: 'Missing.md' }] }).success).toBe(
      false,
    );
    expect(
      obsidianImportRequestSchema.safeParse({
        files: [{ path: 'image.png', data: 'iVBORw0KGgo=', mimeType: 'image/png' }],
      }).success,
    ).toBe(true);
    expect(
      obsidianImportRequestSchema.safeParse({
        files: [{ path: 'image.png', mimeType: 'image/png' }],
      }).success,
    ).toBe(false);
    expect(
      obsidianImportRequestSchema.safeParse({
        files: [{ path: 'image.png', data: 'iVBORw0KGgo=' }],
      }).success,
    ).toBe(false);
    expect(
      obsidianImportRequestSchema.safeParse({
        files: [{ path: '../outside.md', content: '# Outside' }],
      }).success,
    ).toBe(false);
    expect(
      obsidianImportRequestSchema.safeParse({
        files: [{ path: '/absolute.md', content: '# Absolute' }],
      }).success,
    ).toBe(false);
    expect(
      obsidianImportRequestSchema.safeParse({
        files: [
          { path: 'Duplicate.md', content: '# First' },
          { path: 'Duplicate.md', content: '# Second' },
        ],
      }).success,
    ).toBe(false);
    expect(
      obsidianImportRequestSchema.safeParse({ files: [{ path: 'attachments/archive.pdf' }] })
        .success,
    ).toBe(false);
    expect(
      obsidianImportRequestSchema.safeParse({
        files: [{ path: 'attachments/archive.pdf' }, { path: 'notes/Note.md', content: '# Note' }],
      }).success,
    ).toBe(true);
    const emptyImport = obsidianImportRequestSchema.safeParse({ files: [] });
    expect(emptyImport.success).toBe(false);
    if (!emptyImport.success) {
      expect(emptyImport.error.issues[0]?.message).toBe('files array is required');
    }
  });

  it('requires a Markdown multipart file', () => {
    expect(markdownImportRequestSchema.safeParse({}).success).toBe(false);
  });

  it('rejects undocumented lifecycle response fields', () => {
    const id = '5d418de1-6b6f-4bb3-a35c-bc0c134b48dd';
    expect(lifecycleEntityResponseSchema.safeParse({ id, title: 'Browser field' }).success).toBe(
      false,
    );
    expect(
      lifecycleFolderCopyResponseSchema.safeParse({
        id,
        skippedRestrictedItems: false,
        parentId: null,
      }).success,
    ).toBe(false);
    expect(
      lifecyclePageTrashItemSchema.safeParse({
        id,
        title: 'Trashed page',
        icon: null,
        deletedAt: null,
        ownerId: id,
      }).success,
    ).toBe(false);
  });
});
