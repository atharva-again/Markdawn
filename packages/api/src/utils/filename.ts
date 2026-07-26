export function slugifyFilename(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Preserve a page title in an exported filename while removing characters
 * that are invalid on common filesystems. This is intentionally not a slug:
 * capitalization and readable spacing are part of the page title round trip.
 */
export function readableFilename(value: string, fallback = 'Untitled'): string {
  const withoutControlCharacters = Array.from(value.normalize('NFC'), (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 0x7f ? '' : character;
  }).join('');
  const sanitized = withoutControlCharacters
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[ .]+$/g, '')
    .trim();
  const candidate = sanitized || fallback;
  // Windows reserves these names even when they have an extension.
  const period = candidate.indexOf('.');
  const stem = period < 0 ? candidate : candidate.slice(0, period);
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)
    ? `${stem}_${candidate.slice(stem.length)}`
    : candidate;
}

export const MAX_SAFE_FILENAME_BYTES = 240;

function utf8Length(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes < 1) return '';
  let result = '';
  let bytes = 0;
  for (const character of value) {
    const characterBytes = utf8Length(character);
    if (bytes + characterBytes > maxBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result.replace(/[ .]+$/g, '');
}

function filenameWithSuffix(root: string, suffix: string, extension: string): string {
  const availableBytes = MAX_SAFE_FILENAME_BYTES - utf8Length(suffix) - utf8Length(extension);
  const truncatedRoot = truncateUtf8(root, availableBytes) || 'Untitled';
  return `${truncatedRoot}${suffix}${extension}`;
}

/** Allocate a case-insensitively unique, cross-platform-safe filename. */
export function allocateFilename(
  value: string,
  extension: `.${string}`,
  usedNames: Set<string>,
  fallback = 'Untitled',
): string {
  const base = readableFilename(value, fallback);
  const numbered = base.match(/^(.*) \(([2-9][0-9]*)\)$/);
  const root = numbered?.[1] || base;
  let sequence = numbered ? Number(numbered[2]) : 1;
  let candidate = filenameWithSuffix(base, '', extension);
  while (usedNames.has(candidate.toLowerCase())) {
    sequence = sequence < 2 ? 2 : sequence + 1;
    candidate = filenameWithSuffix(root, ` (${sequence})`, extension);
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

export function attachmentContentDisposition(filename: string): string {
  const asciiFallback = Array.from(filename, (character) =>
    (character.codePointAt(0) ?? 0) <= 0x7f ? character : '_',
  ).join('');
  const encodedFilename = encodeURIComponent(filename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`;
}
