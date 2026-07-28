import { describe, expect, it, vi } from 'vitest';
import { routeEditorPaste } from './pasteRouter';

function createOptions() {
  return {
    handleMarkdown: vi.fn(),
    handleTable: vi.fn(),
    handleUrl: vi.fn(() => true),
    isLikelyMarkdown: vi.fn(() => false),
    isLikelyTableData: vi.fn(() => false),
  };
}

describe('routeEditorPaste', () => {
  it('routes a recognized multi-entry URI list before Markdown fallback handling', () => {
    const options = createOptions();
    const urls = ['https://example.com/first', 'https://example.com/second'];

    const handled = routeEditorPaste(
      {
        getData: (format) => {
          if (format === 'text/plain') return '# Markdown-looking fallback';
          if (format === 'text/uri-list') return urls.join('\r\n');
          return '';
        },
      },
      options,
    );

    expect(handled).toBe(true);
    expect(options.handleUrl).toHaveBeenCalledWith({ kind: 'uri-list', urls });
    expect(options.isLikelyMarkdown).not.toHaveBeenCalled();
    expect(options.handleMarkdown).not.toHaveBeenCalled();
  });

  it('routes every URI-list URL when plain text contains only its first URL', () => {
    const options = createOptions();
    const urls = ['https://example.com/first', 'https://example.com/second'];

    routeEditorPaste(
      {
        getData: (format) => {
          if (format === 'text/plain') return urls[0] ?? '';
          if (format === 'text/uri-list') return urls.join('\r\n');
          return '';
        },
      },
      options,
    );

    expect(options.handleUrl).toHaveBeenCalledWith({ kind: 'uri-list', urls });
  });

  it('routes non-URL Markdown to its Markdown handler', () => {
    const options = createOptions();
    options.isLikelyMarkdown.mockReturnValue(true);

    expect(
      routeEditorPaste(
        { getData: (format) => (format === 'text/plain' ? '# Heading' : '') },
        options,
      ),
    ).toBe(true);
    expect(options.handleMarkdown).toHaveBeenCalledWith('# Heading');
  });
});
