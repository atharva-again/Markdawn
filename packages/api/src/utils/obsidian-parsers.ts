import { getV1VaultImportKind, parseMarkdownFrontmatter } from '@markdawn/shared';
export const getExtension = (filename: string): string => {
  const lastDot = filename.lastIndexOf('.');
  return lastDot >= 0 ? filename.slice(lastDot + 1).toLowerCase() : '';
};

export const isImageFile = (filename: string): boolean => {
  const kind = getV1VaultImportKind(filename);
  return kind === 'image' || kind === 'unsupported-image';
};

export const isMarkdownFile = (filename: string): boolean => {
  return getExtension(filename) === 'md';
};

export const parseFrontmatter = parseMarkdownFrontmatter;
