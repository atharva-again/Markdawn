import { find } from 'linkifyjs';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function extractUuidFromSlug(slug: string): string | undefined {
  const uuidMatch = slug.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  const candidate = uuidMatch?.[1];
  return candidate && UUID_REGEX.test(candidate) ? candidate : undefined;
}

export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildPagePath(title: string, pageId: string): string {
  const slug = slugifyTitle(title) || 'page';
  return `/app/${slug}-${pageId}`;
}

export function buildFolderPath(name: string, folderId: string): string {
  const slug = slugifyTitle(name) || 'folder';
  return `/app/folder/${slug}-${folderId}`;
}

export function buildEntityPath(
  entityType: 'page' | 'folder',
  title: string,
  entityId: string,
): string {
  return entityType === 'folder'
    ? buildFolderPath(title, entityId)
    : buildPagePath(title, entityId);
}

const SAFE_LINK_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'sms', 'fax']);
const URL_SCHEME_REGEX = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
const HTTP_URL_REGEX = /^https?:\/\/[^\s]+$/i;

export interface HttpUrlMatch {
  from: number;
  to: number;
  href: string;
}

const hasControlCharacter = (value: string) =>
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });

const isTokenCharacter = (character: string | undefined) =>
  character !== undefined && /[\p{L}\p{N}_@-]/u.test(character);

function hasEmbeddedSchemePrefix(value: string, candidateStart: number): boolean {
  const prefix = value.slice(0, candidateStart);
  const scheme = prefix.match(/https?:\/\/$/i)?.[0];
  return Boolean(scheme && isTokenCharacter(prefix[prefix.length - scheme.length - 1]));
}

function getHttpUrlFromLinkifyMatch(value: string, href: string): string | undefined {
  if (/\s/.test(value) || hasControlCharacter(value) || !HTTP_URL_REGEX.test(href)) {
    return undefined;
  }

  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? href : undefined;
  } catch {
    return undefined;
  }
}

export function findHttpUrls(value: string): HttpUrlMatch[] {
  return find(value, { defaultProtocol: 'https' }).flatMap((candidate) => {
    if (candidate.type !== 'url') return [];
    if (
      isTokenCharacter(value[candidate.start - 1]) ||
      isTokenCharacter(value[candidate.end]) ||
      hasEmbeddedSchemePrefix(value, candidate.start)
    ) {
      return [];
    }
    const href = getHttpUrlFromLinkifyMatch(candidate.value, candidate.href);
    return href ? [{ from: candidate.start, to: candidate.end, href }] : [];
  });
}

/**
 * Returns an absolute HTTP(S) URL when direct editor input is valid for
 * autolinking. Bare domains receive the default HTTPS protocol.
 */
export function getHttpUrl(value: string): string | undefined {
  return findHttpUrls(value).find((match) => match.from === 0 && match.to === value.length)?.href;
}

/**
 * Normalizes links entered in the editor and rejects executable or otherwise
 * unsupported URL schemes. An empty result must never be opened or persisted.
 */
export function ensureAbsoluteUrl(url: string): string {
  if (!url) return url;

  const trimmed = url.trim();
  if (!trimmed || hasControlCharacter(trimmed)) return '';

  // A bare host with a numeric port resembles a URL scheme but should still
  // receive the default HTTPS protocol.
  if (/^[^/?#:]+\.[^/?#:]+:\d+(?:[/?#]|$)/.test(trimmed)) {
    return `https://${trimmed}`;
  }

  const scheme = trimmed.match(URL_SCHEME_REGEX)?.[1]?.toLowerCase();
  if (scheme) {
    return SAFE_LINK_SCHEMES.has(scheme) ? trimmed : '';
  }

  // Leading slash, hash, question mark, or dot → relative/internal
  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('?') ||
    trimmed.startsWith('.')
  )
    return trimmed;

  // Bare domain — dot must appear before any slash so "docs/file.md"
  // is left alone while "samvaad.live" and "samvaad.live/page" get https://
  const slashIndex = trimmed.indexOf('/');
  const dotBeforeSlash =
    slashIndex === -1 ? trimmed.includes('.') : trimmed.slice(0, slashIndex).includes('.');

  if (dotBeforeSlash) return `https://${trimmed}`;

  return trimmed;
}
