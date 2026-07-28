import {
  bindWikiLinkTargets,
  markdownToYjsState,
  stripLeadingH1,
} from '@markdawn/shared/markdown-yjs';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

function toFragment(md: string): Y.XmlFragment {
  const state = markdownToYjsState(md);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc.getXmlFragment('prosemirror');
}

function first(fragment: Y.XmlFragment, index = 0): Y.XmlElement {
  const child = fragment.get(index);
  if (!(child instanceof Y.XmlElement)) {
    throw new Error(`Expected XmlElement at index ${index}`);
  }
  return child;
}

function getText(node: Y.XmlFragment | Y.XmlElement): string {
  let result = '';
  for (let i = 0; i < node.length; i++) {
    const child = node.get(i);
    if (child instanceof Y.XmlText) {
      const delta = child.toDelta();
      for (const op of delta) {
        if (typeof op === 'string') {
          result += op;
        } else {
          result += op.insert ?? '';
        }
      }
    } else if (child instanceof Y.XmlElement) {
      result += getText(child);
    }
  }
  return result;
}

function getTextAt(fragment: Y.XmlFragment, elementIndex: number): string {
  const el = first(fragment, elementIndex);
  return getText(el);
}

describe('stripLeadingH1', () => {
  it('strips leading H1 matching the given title', () => {
    expect(stripLeadingH1('# Hello\n\nWorld', 'Hello')).toBe('\nWorld');
  });

  it('does not strip when title does not match', () => {
    expect(stripLeadingH1('# Hi\n\nWorld', 'Hello')).toBe('# Hi\n\nWorld');
  });

  it('returns input unchanged for empty title', () => {
    expect(stripLeadingH1('# Hello', '')).toBe('# Hello');
  });

  it('handles empty markdown', () => {
    expect(stripLeadingH1('', 'Hello')).toBe('');
  });

  it('handles markdown with no H1', () => {
    expect(stripLeadingH1('## Subheading\n\nContent', 'Title')).toBe('## Subheading\n\nContent');
  });
});

describe('markdownToYjsState', () => {
  describe('headings', () => {
    it('converts h1 with level=1', () => {
      const fragment = toFragment('# Hello');
      expect(fragment.length).toBe(1);
      expect(first(fragment).nodeName).toBe('heading');
      expect(first(fragment).getAttribute('level')).toBe('1');
      expect(getTextAt(fragment, 0)).toBe('Hello');
    });

    it('converts h2 with level=2', () => {
      expect(first(toFragment('## Sub')).getAttribute('level')).toBe('2');
    });

    it('converts h6 with level=6', () => {
      expect(first(toFragment('###### Tiny')).getAttribute('level')).toBe('6');
    });

    it('converts multiple headings', () => {
      const fragment = toFragment('# A\n\n## B\n\n### C');
      expect(fragment.length).toBe(3);
      expect(first(fragment, 0).getAttribute('level')).toBe('1');
      expect(first(fragment, 1).getAttribute('level')).toBe('2');
      expect(first(fragment, 2).getAttribute('level')).toBe('3');
      expect(getTextAt(fragment, 0)).toBe('A');
      expect(getTextAt(fragment, 2)).toBe('C');
    });
  });

  describe('paragraphs', () => {
    it('converts plain text paragraph', () => {
      const fragment = toFragment('Hello world');
      expect(fragment.length).toBe(1);
      expect(first(fragment).nodeName).toBe('paragraph');
      expect(getTextAt(fragment, 0)).toBe('Hello world');
    });

    it('converts multiple paragraphs', () => {
      const fragment = toFragment('First\n\nSecond');
      expect(fragment.length).toBe(2);
      expect(getTextAt(fragment, 0)).toBe('First');
      expect(getTextAt(fragment, 1)).toBe('Second');
    });
  });

  describe('inline marks', () => {
    it('converts bold text', () => {
      const fragment = toFragment('**bold**');
      expect(getTextAt(fragment, 0)).toBe('bold');
      const p = first(fragment);
      const child = p.get(0);
      if (child instanceof Y.XmlText) {
        const delta = child.toDelta();
        const firstOp = delta[0] as { insert?: string; attributes?: Record<string, unknown> };
        expect(firstOp.attributes).toHaveProperty('strong', true);
      }
    });

    it('converts italic text', () => {
      const fragment = toFragment('*italic*');
      expect(getTextAt(fragment, 0)).toBe('italic');
      const p = first(fragment);
      const child = p.get(0);
      if (child instanceof Y.XmlText) {
        const delta = child.toDelta();
        const firstOp = delta[0] as { insert?: string; attributes?: Record<string, unknown> };
        expect(firstOp.attributes).toHaveProperty('emphasis', true);
      }
    });

    it('converts inline code', () => {
      const fragment = toFragment('`code`');
      expect(getTextAt(fragment, 0)).toBe('code');
      const p = first(fragment);
      const child = p.get(0);
      if (child instanceof Y.XmlText) {
        const delta = child.toDelta();
        const firstOp = delta[0] as { insert?: string; attributes?: Record<string, unknown> };
        expect(firstOp.attributes).toHaveProperty('inlineCode', true);
      }
    });

    it('converts strikethrough text', () => {
      const fragment = toFragment('~~strike~~');
      expect(getTextAt(fragment, 0)).toBe('strike');
      const p = first(fragment);
      const child = p.get(0);
      if (child instanceof Y.XmlText) {
        const delta = child.toDelta();
        const firstOp = delta[0] as { insert?: string; attributes?: Record<string, unknown> };
        expect(firstOp.attributes).toHaveProperty('strike_through', true);
      }
    });

    it('converts nested bold+italic', () => {
      const fragment = toFragment('***both***');
      expect(getTextAt(fragment, 0)).toBe('both');
    });

    it('converts inline link with href', () => {
      const fragment = toFragment('[text](https://example.com)');
      expect(getTextAt(fragment, 0)).toBe('text');
    });

    it('converts image with src and alt', () => {
      const fragment = toFragment('![alt](img.png)');
      const p = first(fragment);
      const img = p.get(0);
      if (img instanceof Y.XmlElement) {
        expect(img.nodeName).toBe('image');
        expect(img.getAttribute('src')).toBe('img.png');
        expect(img.getAttribute('alt')).toBe('alt');
      }
    });
  });

  describe('code blocks', () => {
    it('converts code block without language', () => {
      const fragment = toFragment('```\ncode\n```');
      expect(first(fragment).nodeName).toBe('code_block');
      expect(first(fragment).getAttribute('language')).toBe('');
      expect(getTextAt(fragment, 0)).toBe('code');
    });

    it('converts code block with language', () => {
      const fragment = toFragment('```ts\nconst x = 1;\n```');
      expect(first(fragment).getAttribute('language')).toBe('ts');
      expect(getTextAt(fragment, 0)).toBe('const x = 1;');
    });
  });

  describe('blockquotes', () => {
    it('converts blockquote', () => {
      const fragment = toFragment('> quoted');
      expect(first(fragment).nodeName).toBe('blockquote');
      expect(getTextAt(fragment, 0)).toContain('quoted');
    });
  });

  describe('lists', () => {
    it('converts unordered list items', () => {
      const fragment = toFragment('- Item 1\n- Item 2');
      expect(fragment.length).toBe(1);
      expect(first(fragment).nodeName).toBe('bullet_list');
    });

    it('converts ordered list with default order', () => {
      const fragment = toFragment('1. First\n2. Second');
      expect(first(fragment).nodeName).toBe('ordered_list');
    });

    it('converts task list with checked attribute', () => {
      const fragment = toFragment('- [x] Done\n- [ ] Todo');
      expect(first(fragment).nodeName).toBe('bullet_list');
      const list = first(fragment);
      const item = list.get(0);
      if (item instanceof Y.XmlElement) {
        expect(item.nodeName).toBe('list_item');
        expect(item.getAttribute('checked')).toBe('true');
      }
      const item2 = list.get(1);
      if (item2 instanceof Y.XmlElement) {
        expect(item2.getAttribute('checked')).toBe('false');
      }
    });
  });

  describe('thematic break', () => {
    it('converts horizontal rule', () => {
      const fragment = toFragment('---');
      expect(first(fragment).nodeName).toBe('hr');
    });
  });

  describe('tables', () => {
    it('converts GFM table', () => {
      const md = '| L | C | R |\n| --- | :---: | ---: |\n| a | b | c |';
      const fragment = toFragment(md);
      expect(first(fragment).nodeName).toBe('table');
    });
  });

  describe('math', () => {
    it('converts inline math to math_inline inside paragraph', () => {
      const fragment = toFragment('$E=mc^2$');
      const p = first(fragment);
      expect(p.nodeName).toBe('paragraph');
      const mathEl = p.get(0);
      if (mathEl instanceof Y.XmlElement) {
        expect(mathEl.nodeName).toBe('math_inline');
        expect(mathEl.getAttribute('value')).toBe('E=mc^2');
      }
    });

    it('converts block math to code_block with LaTeX', () => {
      const fragment = toFragment('$$\na^2 + b^2 = c^2\n$$');
      expect(first(fragment).nodeName).toBe('code_block');
      expect(first(fragment).getAttribute('language')).toBe('LaTeX');
    });

    it('mixes inline math with regular text', () => {
      const fragment = toFragment('Equation: $x=1$');
      expect(fragment.length).toBe(1);
      const p = first(fragment);
      expect(p.length).toBeGreaterThanOrEqual(2);
      const firstChild = p.get(0);
      if (firstChild instanceof Y.XmlText) {
        expect(firstChild.toString()).toBe('Equation: ');
      }
    });
  });

  describe('wiki links and tags', () => {
    it('converts [[Page]] to wikiLink element', () => {
      const fragment = toFragment('[[My Page]]');
      const p = first(fragment);
      const link = p.get(0);
      if (link instanceof Y.XmlElement) {
        expect(link.nodeName).toBe('wikiLink');
        expect(link.getAttribute('path')).toBe('My Page');
        expect(link.getAttribute('label')).toBe('');
        expect(link.getAttribute('targetId')).toBeUndefined();
      }
    });

    it('converts [[Page|Alias]] with custom label', () => {
      const fragment = toFragment('[[Doc|See this]]');
      const p = first(fragment);
      const link = p.get(0);
      if (link instanceof Y.XmlElement) {
        expect(link.getAttribute('path')).toBe('Doc');
        expect(link.getAttribute('label')).toBe('See this');
      }
    });

    it('mixes wiki links with regular text', () => {
      const fragment = toFragment('See [[Page]] for details');
      const p = first(fragment);
      expect(p.length).toBeGreaterThanOrEqual(3);
      const second = p.get(1);
      if (second instanceof Y.XmlElement) {
        expect(second.nodeName).toBe('wikiLink');
      }
    });

    it('binds a unique target without retaining its default title', () => {
      const targetId = '11111111-1111-4111-8111-111111111111';
      const bound = bindWikiLinkTargets(
        markdownToYjsState('See [[/Roadmap.md#Plan]] and [[Roadmap|Project plan]]'),
        new Map([['roadmap', targetId]]),
      );
      const doc = new Y.Doc();
      Y.applyUpdate(doc, bound);
      const paragraph = first(doc.getXmlFragment('prosemirror'));
      const defaultLink = paragraph.get(1) as Y.XmlElement;
      const aliasedLink = paragraph.get(3) as Y.XmlElement;

      expect(defaultLink.getAttribute('targetId')).toBe(targetId);
      expect(defaultLink.getAttribute('path')).toBe('');
      expect(defaultLink.getAttribute('heading')).toBe('Plan');
      expect(defaultLink.getAttribute('label')).toBe('');
      expect(aliasedLink.getAttribute('targetId')).toBe(targetId);
      expect(aliasedLink.getAttribute('path')).toBe('');
      expect(aliasedLink.getAttribute('label')).toBe('Project plan');
      expect(Buffer.from(bound).includes(Buffer.from('Roadmap'))).toBe(false);
    });

    it('preserves an explicit alias even when it equals the authored path', () => {
      const targetId = '11111111-1111-4111-8111-111111111111';
      const bound = bindWikiLinkTargets(
        markdownToYjsState('[[Roadmap|Roadmap]]'),
        new Map([['roadmap', targetId]]),
      );
      const doc = new Y.Doc();
      Y.applyUpdate(doc, bound);
      const link = first(doc.getXmlFragment('prosemirror')).get(0) as Y.XmlElement;

      expect(link.getAttribute('targetId')).toBe(targetId);
      expect(link.getAttribute('path')).toBe('');
      expect(link.getAttribute('label')).toBe('Roadmap');
    });
  });

  describe('edge cases', () => {
    it('handles empty markdown', () => {
      const fragment = toFragment('');
      expect(fragment.length).toBe(0);
    });

    it('handles whitespace-only content', () => {
      expect(() => markdownToYjsState('   \n\n  ')).not.toThrow();
    });

    it('handles very long markdown without crash', () => {
      const md = `# H\n\n${'Paragraph. '.repeat(2000)}`;
      expect(() => markdownToYjsState(md)).not.toThrow();
    });

    it('handles markdown with null bytes', () => {
      expect(() => markdownToYjsState('hello\x00world')).not.toThrow();
    });

    it('handles unicode characters', () => {
      const fragment = toFragment('# 你好\n\n- 项目 1\n- 项目 2');
      expect(fragment.length).toBeGreaterThan(0);
      expect(getText(fragment)).toContain('你好');
    });

    it('handles mixed content with all block types', () => {
      const md = [
        '# Title',
        '',
        'Intro text with **bold** and *italic*.',
        '',
        '> Blockquote here',
        '',
        '- List item A',
        '- List item B',
        '',
        '```ts',
        'const x = 1;',
        '```',
        '',
        'More text with `inline code`.',
      ].join('\n');
      const fragment = toFragment(md);
      expect(fragment.length).toBe(6);
    });

    it('handles only special characters', () => {
      expect(() => markdownToYjsState('***___~~~```')).not.toThrow();
    });
  });

  describe('property-based (random inputs)', () => {
    it('never crashes on random printable ASCII', () => {
      for (let trial = 0; trial < 50; trial++) {
        const len = Math.floor(Math.random() * 300);
        const str = Array.from({ length: len }, () =>
          String.fromCharCode(32 + Math.floor(Math.random() * 95)),
        ).join('');
        expect(() => markdownToYjsState(str)).not.toThrow();
      }
    });

    it('never crashes on random unicode', () => {
      for (let trial = 0; trial < 20; trial++) {
        const len = Math.floor(Math.random() * 200);
        const str = Array.from({ length: len }, () =>
          String.fromCharCode(Math.floor(Math.random() * 0x3000)),
        ).join('');
        expect(() => markdownToYjsState(str)).not.toThrow();
      }
    });
  });
});
