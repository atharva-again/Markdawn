import path from 'node:path';
import { z } from 'zod';
import { safeImageMimeForExtension } from './image-upload';
import { getExtension, isImageFile, isMarkdownFile } from './obsidian-parsers';

export type VaultImportKind = 'markdown' | 'image' | null;

export function isCanonicalRelativeVaultPath(value: string): boolean {
  if (
    value.length === 0 ||
    value.includes('\0') ||
    value.includes('\\') ||
    path.posix.isAbsolute(value) ||
    /^[a-z]:\//i.test(value)
  ) {
    return false;
  }
  const parts = value.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) return false;
  return path.posix.normalize(value) === value;
}

export function getVaultImportKind(value: string): VaultImportKind {
  if (isMarkdownFile(value)) return 'markdown';
  return safeImageMimeForExtension(getExtension(value)) ? 'image' : null;
}

export const vaultImportFileSchema = z
  .object({
    path: z.string(),
    content: z.string().optional(),
    data: z.string().optional(),
    mimeType: z.string().optional(),
  })
  .strict()
  .superRefine((file, context) => {
    if (!isCanonicalRelativeVaultPath(file.path)) {
      context.addIssue({
        code: 'custom',
        path: ['path'],
        message: 'path must be a canonical relative vault path',
      });
      return;
    }
    const kind = getVaultImportKind(file.path);
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
    if (!isImageFile(file.path)) return;
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
  .object({ files: z.array(vaultImportFileSchema).min(1, 'files array is required') })
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
      if (isCanonicalRelativeVaultPath(file.path) && getVaultImportKind(file.path) !== null) {
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

export type VaultImportFile = z.infer<typeof vaultImportFileSchema>;
