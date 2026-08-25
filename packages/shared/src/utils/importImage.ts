export const SUPPORTED_IMPORT_IMAGE_EXTENSIONS = ['jpeg', 'jpg', 'png', 'gif', 'webp'] as const;

export function isSupportedImportImagePath(value: string): boolean {
  const extension = value.slice(value.lastIndexOf('.') + 1).toLowerCase();
  return SUPPORTED_IMPORT_IMAGE_EXTENSIONS.some((supported) => supported === extension);
}
