import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createYjsDocWithTitle } from './markdownToYjs';
import { replaceMarkdownBody } from './yjsDocumentReplacement';

describe('replaceMarkdownBody', () => {
  it('uses the supplied transaction origin', () => {
    const document = new Y.Doc();
    Y.applyUpdate(document, createYjsDocWithTitle('Page', 'Before'));
    let updateOrigin: unknown;
    document.on('update', (_update, origin) => {
      updateOrigin = origin;
    });

    replaceMarkdownBody(document, 'Page', 'After', null);

    expect(updateOrigin).toBeNull();
    document.destroy();
  });
});
