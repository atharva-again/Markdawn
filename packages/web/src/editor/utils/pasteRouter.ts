import type { UrlPasteIntent } from './urlPaste';
import { getUrlPasteIntent } from './urlPaste';

type ClipboardData = Pick<DataTransfer, 'getData'>;

interface PasteRouterOptions {
  handleMarkdown: (text: string) => void;
  handleTable: (text: string) => void;
  handleUrl: (intent: UrlPasteIntent) => boolean;
  isLikelyMarkdown: (text: string) => boolean;
  isLikelyTableData: (text: string) => boolean;
}

/** Routes each clipboard payload once to URL, table, Markdown, or native paste. */
export function routeEditorPaste(
  clipboardData: ClipboardData | null,
  options: PasteRouterOptions,
): boolean {
  const urlIntent = getUrlPasteIntent(clipboardData);
  if (urlIntent) return options.handleUrl(urlIntent);

  const text = clipboardData?.getData('text/plain') || clipboardData?.getData('Text') || '';
  if (!text) return false;
  if (options.isLikelyTableData(text)) {
    options.handleTable(text);
    return true;
  }
  if (options.isLikelyMarkdown(text)) {
    options.handleMarkdown(text);
    return true;
  }
  return false;
}
