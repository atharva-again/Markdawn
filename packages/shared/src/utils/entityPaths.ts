export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildPagePath(title: string, pageId: string): string {
  return `/${slugifyTitle(title) || 'page'}-${pageId}`;
}

export function buildFolderPath(name: string, folderId: string): string {
  return `/folder/${slugifyTitle(name) || 'folder'}-${folderId}`;
}
