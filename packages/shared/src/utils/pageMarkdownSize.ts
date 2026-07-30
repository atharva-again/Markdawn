import { MAX_YDOC_BYTES } from '../constants/collaboration.js';

export type PageMarkdownErrorCode =
  | 'document_too_large'
  | 'edit_work_limit'
  | 'unsupported_frontmatter'
  | 'invalid_icon'
  | 'invalid_properties';

export class PageMarkdownError extends Error {
  constructor(
    readonly code: PageMarkdownErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const PAGE_MARKDOWN_SIZE_ERROR_MESSAGE = `Document must be ${MAX_YDOC_BYTES} bytes or less`;

export function pageMarkdownByteLength(markdown: string): number {
  return new TextEncoder().encode(markdown).byteLength;
}

export function fitsPageMarkdownSize(markdown: string): boolean {
  return pageMarkdownByteLength(markdown) <= MAX_YDOC_BYTES;
}

export function assertPageMarkdownSize(markdown: string): void {
  if (!fitsPageMarkdownSize(markdown)) {
    throw new PageMarkdownError('document_too_large', PAGE_MARKDOWN_SIZE_ERROR_MESSAGE);
  }
}
