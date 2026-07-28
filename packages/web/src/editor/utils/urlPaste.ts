import { getHttpUrl } from '../../utils/url';

export type UrlPasteIntent =
  | { kind: 'direct-url'; source: 'plain-text' | 'uri-list'; url: string }
  | { kind: 'uri-list'; urls: string[] };

type ClipboardData = Pick<DataTransfer, 'getData'>;

function getUriListUrls(clipboardData: ClipboardData): string[] | undefined {
  const uriList = clipboardData.getData('text/uri-list');
  if (!uriList) return undefined;

  const urls: string[] = [];
  for (const line of uriList.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const url = getHttpUrl(line);
    if (!url) return undefined;
    urls.push(url);
  }
  return urls.length > 0 ? urls : undefined;
}

/** Classifies URL clipboard formats without mutating editor state. */
export function getUrlPasteIntent(clipboardData: ClipboardData | null): UrlPasteIntent | undefined {
  if (!clipboardData) return undefined;

  const uriListUrls = getUriListUrls(clipboardData);
  if (uriListUrls && uriListUrls.length > 1) return { kind: 'uri-list', urls: uriListUrls };
  if (uriListUrls?.length === 1) {
    const url = uriListUrls[0];
    if (!url) throw new Error('Single URL clipboard intent is missing its URL');
    return { kind: 'direct-url', source: 'uri-list', url };
  }

  const plainText = clipboardData.getData('text/plain') || clipboardData.getData('Text');
  const plainTextUrl = plainText ? getHttpUrl(plainText.trim()) : undefined;
  if (plainTextUrl) return { kind: 'direct-url', source: 'plain-text', url: plainTextUrl };

  return undefined;
}
