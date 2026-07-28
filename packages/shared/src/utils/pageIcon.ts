export function normalizePageIcon(icon: string | null): string | null {
  return typeof icon === 'string' && icon.trim() ? icon.trim() : null;
}
