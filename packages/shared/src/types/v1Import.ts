import { z } from 'zod';
import { getFileExtension } from '../utils/fileExtension.js';
import { isSupportedImportImageExtension } from '../utils/importImage.js';

export type V1VaultImportKind = 'markdown' | 'image' | 'unsupported-image' | null;

export function isCanonicalRelativeV1VaultPath(value: string): boolean {
  if (
    value.length === 0 ||
    value.includes('\0') ||
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[a-z]:\//i.test(value)
  ) {
    return false;
  }
  const parts = value.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) return false;
  return true;
}

export function getV1VaultImportKind(value: string): V1VaultImportKind {
  const extension = getFileExtension(value);
  if (extension === 'md') return 'markdown';
  if (isSupportedImportImageExtension(extension)) return 'image';
  return extension === 'svg' ? 'unsupported-image' : null;
}

export const v1VaultImportFileSchema = z
  .object({
    path: z.string(),
    content: z.string().optional(),
    data: z.string().optional(),
    mimeType: z.string().optional(),
  })
  .strict()
  .superRefine((file, context) => {
    if (!isCanonicalRelativeV1VaultPath(file.path)) {
      context.addIssue({
        code: 'custom',
        path: ['path'],
        message: 'path must be a canonical relative vault path',
      });
      return;
    }
    const kind = getV1VaultImportKind(file.path);
    if (kind === 'markdown') {
      if (file.content === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['content'],
          message: 'content is required for Markdown files',
        });
      }
      return;
    }
    if (kind !== 'image' && kind !== 'unsupported-image') return;
    if (file.data === undefined || file.data.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['data'],
        message: 'data is required for image files',
      });
    }
    if (file.mimeType === undefined || file.mimeType.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['mimeType'],
        message: 'mimeType is required for image files',
      });
    }
  });

export const vaultImportRequestSchema = z
  .object({ files: z.array(v1VaultImportFileSchema).min(1, 'files array is required') })
  .strict()
  .superRefine((request, context) => {
    const paths = new Set<string>();
    let hasImportableFile = false;
    for (const [index, file] of request.files.entries()) {
      if (paths.has(file.path)) {
        context.addIssue({
          code: 'custom',
          path: ['files', index, 'path'],
          message: 'duplicate vault path',
        });
      }
      paths.add(file.path);
      const kind = isCanonicalRelativeV1VaultPath(file.path)
        ? getV1VaultImportKind(file.path)
        : null;
      if (kind === 'markdown' || kind === 'image') {
        hasImportableFile = true;
      }
    }
    if (!hasImportableFile) {
      context.addIssue({
        code: 'custom',
        path: ['files'],
        message: 'files must include a Markdown file or supported image',
      });
    }
  })
  .meta({
    example: {
      files: [{ path: 'Welcome.md', content: '# Welcome\n' }],
    },
  });

export type V1VaultImportFile = z.infer<typeof v1VaultImportFileSchema>;
