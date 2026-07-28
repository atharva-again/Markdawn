import { createYjsDocWithTitle } from '@markdawn/shared/markdown-yjs';
import { replaceMarkdownBody } from '@markdawn/shared/yjs-document-replacement';
import { yDocToMarkdown } from '@markdawn/shared/yjs-helpers';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

describe('replaceMarkdownBody', () => {
  it('preserves unchanged top-level Yjs nodes', () => {
    const document = new Y.Doc();
    Y.applyUpdate(
      document,
      createYjsDocWithTitle('Page title', '## Notes\n\nFirst paragraph.\n\nSecond paragraph.\n'),
    );
    const fragment = document.getXmlFragment('prosemirror');
    const heading = fragment.get(0);
    const firstParagraph = fragment.get(1);

    replaceMarkdownBody(
      document,
      'Page title',
      '## Notes\n\nFirst paragraph.\n\nRevised paragraph.\n',
    );

    expect(fragment.get(0)).toBe(heading);
    expect(fragment.get(1)).toBe(firstParagraph);
    expect(yDocToMarkdown(Y.encodeStateAsUpdate(document))).toBe(
      '## Notes\n\nFirst paragraph.\n\nRevised paragraph.\n\n',
    );
  });
});
