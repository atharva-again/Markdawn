export const getExtension = (filename: string): string => {
  const lastDot = filename.lastIndexOf('.');
  return lastDot >= 0 ? filename.slice(lastDot + 1).toLowerCase() : '';
};

const ALLOWED_IMAGE_TYPES = new Set(['jpeg', 'jpg', 'png', 'gif', 'webp', 'svg']);

export const isImageFile = (filename: string): boolean => {
  return ALLOWED_IMAGE_TYPES.has(getExtension(filename));
};

export const isMarkdownFile = (filename: string): boolean => {
  return getExtension(filename) === 'md';
};

export const parseFrontmatter = parseMarkdownFrontmatter;

import { parseMarkdownFrontmatter } from '@markdawn/shared';
