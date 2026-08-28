export function getFileExtension(value: string): string {
  const lastSeparator = value.lastIndexOf('/');
  const lastDot = value.lastIndexOf('.');
  return lastDot > lastSeparator ? value.slice(lastDot + 1).toLowerCase() : '';
}
