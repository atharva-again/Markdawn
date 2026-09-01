import { getFileExtension } from './fileExtension.js';

export const SUPPORTED_IMPORT_IMAGE_EXTENSIONS = ['jpeg', 'jpg', 'png', 'gif', 'webp'] as const;

export function isSupportedImportImageExtension(value: string): boolean {
  const extension = value.toLowerCase();
  return SUPPORTED_IMPORT_IMAGE_EXTENSIONS.some((supported) => supported === extension);
}

export function isSupportedImportImagePath(value: string): boolean {
  return isSupportedImportImageExtension(getFileExtension(value));
}
