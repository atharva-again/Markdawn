import type { EditorView } from '@milkdown/kit/prose/view';
import { Fragment, Schema, Slice } from 'prosemirror-model';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { describe, expect, it, vi } from 'vitest';
import { repairDocument } from '../utils/documentRepair';
import { isEligibleAutolinkRange } from '../utils/textRunUrls';
import { getUrlPasteIntent } from '../utils/urlPaste';
import {
  createAutolinkPastePlugin,
  handleUrlPasteIntent,
  linkifyPastedSlice,
} from './autolinkPaste';
import {
  createAutolinkTypingPlugin,
  handleAutolinkCompletedInput,
  handleAutolinkEnter,
  handleAutolinkTextInput,
} from './autolinkTyping';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    code_block: { content: 'text*', group: 'block', code: true },
    text: { group: 'inline' },
    hard_break: { inline: true, group: 'inline' },
    math_inline: { inline: true, group: 'inline', atom: true },
    tag: { inline: true, group: 'inline', atom: true },
  },
  marks: {
    link: { attrs: { href: {} }, inclusive: false },
    strong: {},
    emphasis: {},
    code: { code: true },
  },
});

const paragraphType = schema.nodes.paragraph;
const codeBlockType = schema.nodes.code_block;
const hardBreakType = schema.nodes.hard_break;
const mathInlineType = schema.nodes.math_inline;
const tagType = schema.nodes.tag;
const linkMarkType = schema.marks.link;
const strongMarkType = schema.marks.strong;
const emphasisMarkType = schema.marks.emphasis;
const codeMarkType = schema.marks.code;
if (
  !paragraphType ||
  !codeBlockType ||
  !hardBreakType ||
  !mathInlineType ||
  !tagType ||
  !linkMarkType ||
  !strongMarkType ||
  !emphasisMarkType ||
  !codeMarkType
) {
  throw new Error('Autolink test schema is incomplete');
}

describe('linkifyPastedSlice', () => {
  it('links URLs without changing pasted block or hard-break structure', () => {
    const doc = schema.node('doc', null, [
      paragraphType.create(null, [
        schema.text('First https://example.com/path, then '),
        hardBreakType.create(),
        schema.text('example.org.'),
      ]),
      paragraphType.create(null, schema.text('Final paragraph')),
    ]);

    const result = linkifyPastedSlice(new Slice(doc.content, 0, 0), linkMarkType);

    expect(result.content.childCount).toBe(2);
    let hardBreakCount = 0;
    result.content.descendants((node) => {
      if (node.type === hardBreakType) hardBreakCount += 1;
    });
    expect(hardBreakCount).toBe(1);
    expect(result.content.textBetween(0, result.content.size, '\n\n', '\n')).toBe(
      'First https://example.com/path, then \nexample.org.\n\nFinal paragraph',
    );
    const links: Array<{ text: string; href: string }> = [];
    result.content.descendants((node) => {
      const link = linkMarkType.isInSet(node.marks);
      if (node.isText && link) links.push({ text: node.text ?? '', href: link.attrs.href });
    });
    expect(links).toEqual([
      { text: 'https://example.com/path', href: 'https://example.com/path' },
      { text: 'example.org', href: 'https://example.org' },
    ]);
  });

  it('leaves a direct URL plain when the selected range spans inline code', () => {
    const code = codeMarkType.create();
    const url = 'https://example.com/plain-selection';
    const doc = schema.node(
      'doc',
      null,
      paragraphType.create(null, [schema.text('plain '), schema.text('code', [code])]),
    );
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, 1, doc.content.size - 1),
    });
    const plugin = createAutolinkPastePlugin(linkMarkType);
    const transformPasted = plugin.props.transformPasted;
    if (!transformPasted) throw new Error('Expected autolink paste transform');

    const result = transformPasted.call(
      plugin,
      new Slice(Fragment.from(schema.text(url)), 0, 0),
      { state } as unknown as EditorView,
      false,
    );

    expect(linkMarkType.isInSet(result.content.firstChild?.marks ?? [])).toBeUndefined();
  });

  it('leaves a direct URL plain when inline code is an active stored mark', () => {
    const url = 'https://example.com/stored-code';
    const doc = schema.node('doc', null, paragraphType.create());
    const state = EditorState.create({ schema, doc, storedMarks: [codeMarkType.create()] });
    const plugin = createAutolinkPastePlugin(linkMarkType);
    const transformPasted = plugin.props.transformPasted;
    if (!transformPasted) throw new Error('Expected autolink paste transform');

    const result = transformPasted.call(
      plugin,
      new Slice(Fragment.from(schema.text(url)), 0, 0),
      { state } as unknown as EditorView,
      false,
    );

    expect(linkMarkType.isInSet(result.content.firstChild?.marks ?? [])).toBeUndefined();
  });

  it('preserves formatting and leaves inline and fenced code untouched', () => {
    const strong = strongMarkType.create();
    const code = codeMarkType.create();
    const doc = schema.node('doc', null, [
      paragraphType.create(null, schema.text('https://formatted.example', [strong])),
      paragraphType.create(null, schema.text('https://inline-code.example', [code])),
      codeBlockType.create(null, schema.text('https://code-block.example')),
    ]);

    const result = linkifyPastedSlice(new Slice(doc.content, 0, 0), linkMarkType);
    const firstText = result.content.firstChild?.firstChild;
    const inlineCodeText = result.content.child(1).firstChild;
    const codeBlockText = result.content.child(2).firstChild;

    expect(strongMarkType.isInSet(firstText?.marks ?? [])).toBeTruthy();
    expect(linkMarkType.isInSet(firstText?.marks ?? [])?.attrs.href).toBe(
      'https://formatted.example',
    );
    expect(linkMarkType.isInSet(inlineCodeText?.marks ?? [])).toBeUndefined();
    expect(linkMarkType.isInSet(codeBlockText?.marks ?? [])).toBeUndefined();
  });

  it('links a URL across formatting boundaries without removing formatting', () => {
    const strong = strongMarkType.create();
    const emphasis = emphasisMarkType.create();
    const href = 'https://example.com/path';
    const doc = schema.node(
      'doc',
      null,
      paragraphType.create(null, [
        schema.text('https://exa', [strong]),
        schema.text('mple', [emphasis]),
        schema.text('.com/path'),
      ]),
    );

    const result = linkifyPastedSlice(new Slice(doc.content, 0, 0), linkMarkType);
    const paragraph = result.content.firstChild;
    if (!paragraph) throw new Error('Expected a linked paragraph');

    expect(paragraph.textContent).toBe(href);
    expect(paragraph.childCount).toBe(3);
    for (let index = 0; index < paragraph.childCount; index++) {
      expect(linkMarkType.isInSet(paragraph.child(index).marks)?.attrs.href).toBe(href);
    }
    expect(strongMarkType.isInSet(paragraph.child(0).marks)).toBeTruthy();
    expect(emphasisMarkType.isInSet(paragraph.child(1).marks)).toBeTruthy();
  });

  it('linkifies a large single paragraph in one pass', () => {
    const prefix = 'plain text '.repeat(10_000);
    const href = 'https://example.com/large-paste';
    const doc = schema.node(
      'doc',
      null,
      paragraphType.create(null, schema.text(`${prefix}${href}`)),
    );

    const result = linkifyPastedSlice(new Slice(doc.content, 0, 0), linkMarkType);
    const linkedNode = result.content.firstChild?.lastChild;

    expect(result.content.textBetween(0, result.content.size)).toBe(`${prefix}${href}`);
    expect(linkMarkType.isInSet(linkedNode?.marks ?? [])?.attrs.href).toBe(href);
  });

  it('does not link a URL embedded in a malformed token prefix', () => {
    const doc = schema.node(
      'doc',
      null,
      paragraphType.create(null, schema.text('abchttps://example.com')),
    );

    const result = linkifyPastedSlice(new Slice(doc.content, 0, 0), linkMarkType);

    expect(result.content.firstChild?.firstChild?.marks).toEqual([]);
  });

  it('does not link an unmarked suffix contiguous with existing linked URL text', () => {
    const existingLink = linkMarkType.create({ href: 'https://target.example' });
    const doc = schema.node(
      'doc',
      null,
      paragraphType.create(null, [
        schema.text('https://', [existingLink]),
        schema.text('example.com'),
      ]),
    );

    const result = linkifyPastedSlice(new Slice(doc.content, 0, 0), linkMarkType);
    const suffix = result.content.firstChild?.lastChild;

    expect(linkMarkType.isInSet(suffix?.marks ?? [])).toBeUndefined();
  });

  it.each([
    '192.168.1.1',
    'foo.invalidtld',
  ])('uses the same rejection policy for cursor and selection paste: %s', (value) => {
    const doc = schema.node('doc', null, paragraphType.create(null, schema.text(value)));
    const result = linkifyPastedSlice(new Slice(doc.content, 0, 0), linkMarkType);

    expect(
      getUrlPasteIntent({ getData: (format) => (format === 'text/plain' ? value : '') }),
    ).toBeUndefined();
    expect(result.content.firstChild?.firstChild?.marks).toEqual([]);
  });
});

describe('getUrlPasteIntent', () => {
  it('uses a valid URI-list destination when plain text is a label', () => {
    const url = 'https://example.com/from-uri-list';
    expect(
      getUrlPasteIntent({
        getData: (format) => {
          if (format === 'text/plain') return 'Human-readable label';
          if (format === 'text/uri-list') return `# source\r\n${url}`;
          return '';
        },
      }),
    ).toEqual({ kind: 'direct-url', source: 'uri-list', url });
  });

  it('prefers a URI-list destination over a different valid URL label', () => {
    const destination = 'https://example.com/destination';
    expect(
      getUrlPasteIntent({
        getData: (format) => {
          if (format === 'text/plain') return 'https://example.com/visible-label';
          if (format === 'text/uri-list') return destination;
          return '';
        },
      }),
    ).toEqual({ kind: 'direct-url', source: 'uri-list', url: destination });
  });

  it('normalizes a bare URI-list host', () => {
    expect(
      getUrlPasteIntent({
        getData: (format) => (format === 'text/uri-list' ? 'example.com' : ''),
      }),
    ).toEqual({ kind: 'direct-url', source: 'uri-list', url: 'https://example.com' });
  });

  it('prioritizes a multi-entry URI list over a plain-text first URL', () => {
    const urls = ['https://example.com/first', 'https://example.com/second'];
    expect(
      getUrlPasteIntent({
        getData: (format) => {
          if (format === 'text/plain') return urls[0] ?? '';
          if (format === 'text/uri-list') return urls.join('\r\n');
          return '';
        },
      }),
    ).toEqual({ kind: 'uri-list', urls });
  });

  it('accepts a URL containing Markdown-like syntax', () => {
    const url = 'https://example.com/$foo$';
    expect(
      getUrlPasteIntent({
        getData: (format) => (format === 'text/plain' ? url : ''),
      }),
    ).toEqual({ kind: 'direct-url', source: 'plain-text', url });
  });
});

describe('handleUrlPasteIntent', () => {
  it('replaces a selection with all URLs from a multi-entry URI list', () => {
    const label = 'selected label';
    const urls = ['https://example.com/first', 'https://example.com/second'];
    const doc = schema.node('doc', null, paragraphType.create(null, schema.text(label)));
    let state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, 1, label.length + 1),
    });
    const view = {
      get state() {
        return state;
      },
      dispatch(transaction: Transaction) {
        state = state.apply(transaction);
      },
    } as unknown as EditorView;

    expect(handleUrlPasteIntent(view, { kind: 'uri-list', urls })).toBe(true);
    expect(state.doc.childCount).toBe(2);
    expect(state.doc.textContent).toBe(urls.join(''));
    state.doc.descendants((node) => {
      if (!node.isText) return;
      expect(linkMarkType.isInSet(node.marks)?.attrs.href).toBe(node.text);
    });
  });

  it('preserves active formatting for every multi-entry URI-list URL', () => {
    const urls = ['https://example.com/first', 'https://example.com/second'];
    const doc = schema.node('doc', null, paragraphType.create());
    let state = EditorState.create({
      schema,
      doc,
      storedMarks: [strongMarkType.create()],
    });
    const view = {
      get state() {
        return state;
      },
      dispatch(transaction: Transaction) {
        state = state.apply(transaction);
      },
    } as unknown as EditorView;

    expect(handleUrlPasteIntent(view, { kind: 'uri-list', urls })).toBe(true);
    state.doc.descendants((node) => {
      if (!node.isText) return;
      expect(strongMarkType.isInSet(node.marks)).toBeTruthy();
      expect(linkMarkType.isInSet(node.marks)?.attrs.href).toBe(node.text);
    });
  });
});

describe('autolink typing and repair', () => {
  it('cancels deferred completion when its plugin view is destroyed', () => {
    vi.useFakeTimers();
    const plugin = createAutolinkTypingPlugin();
    const view = {
      isDestroyed: false,
      state: { selection: { empty: true, from: 1, to: 1 } },
    } as unknown as EditorView;
    const pluginView = plugin.spec.view?.call(plugin, view);
    const compositionend = plugin.props.handleDOMEvents?.compositionend;
    if (!pluginView?.destroy || !compositionend) {
      throw new Error('Expected autolink typing lifecycle handlers');
    }

    compositionend.call(plugin, view, new CompositionEvent('compositionend'));
    pluginView.destroy();
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it('does not complete deferred input for a destroyed editor view', () => {
    vi.useFakeTimers();
    const plugin = createAutolinkTypingPlugin();
    const view = {
      isDestroyed: true,
      state: { selection: { empty: true, from: 1, to: 1 } },
    } as unknown as EditorView;
    const compositionend = plugin.props.handleDOMEvents?.compositionend;
    if (!compositionend) throw new Error('Expected autolink composition handler');

    compositionend.call(plugin, view, new CompositionEvent('compositionend'));
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it('does not complete deferred input after the cursor moves', () => {
    vi.useFakeTimers();
    const plugin = createAutolinkTypingPlugin();
    const state = { selection: { empty: true, from: 1, to: 1 } };
    const view = { isDestroyed: false, state } as unknown as EditorView;
    const beforeinput = plugin.props.handleDOMEvents?.beforeinput;
    if (!beforeinput) throw new Error('Expected autolink input handler');

    beforeinput.call(plugin, view, {
      inputType: 'insertText',
      data: 'https://example.com ',
    } as InputEvent);
    state.selection = { empty: true, from: 2, to: 2 };
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it('does not complete composition input after the settled cursor moves', () => {
    vi.useFakeTimers();
    const plugin = createAutolinkTypingPlugin();
    const state = { selection: { empty: true, from: 1, to: 1 } };
    const view = { isDestroyed: false, state } as unknown as EditorView;
    const compositionend = plugin.props.handleDOMEvents?.compositionend;
    if (!compositionend) throw new Error('Expected autolink composition handler');

    compositionend.call(plugin, view, new CompositionEvent('compositionend'));
    vi.advanceTimersByTime(0);
    state.selection = { empty: true, from: 2, to: 2 };
    vi.advanceTimersByTime(1);
    vi.useRealTimers();
  });

  it('does not claim non-autolink text input', () => {
    const doc = schema.node('doc', null, paragraphType.create());
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, 1),
    });
    const view = { state } as unknown as EditorView;
    const plugin = createAutolinkTypingPlugin();
    const beforeinput = plugin.props.handleDOMEvents?.beforeinput;
    if (!beforeinput) throw new Error('Expected autolink input handler');

    expect(
      beforeinput.call(plugin, view, {
        inputType: 'insertText',
        data: 'x',
      } as InputEvent),
    ).toBe(false);
  });

  it('marks a typed URL through the text-input fallback', () => {
    const url = 'https://example.com/text-input-fallback';
    const doc = schema.node('doc', null, paragraphType.create(null, schema.text(url)));
    let state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, url.length + 1),
    });
    const view = {
      get state() {
        return state;
      },
      dispatch(transaction: Transaction) {
        state = state.apply(transaction);
      },
    } as unknown as EditorView;
    const plugin = createAutolinkTypingPlugin();
    const handleTextInput = plugin.props.handleTextInput;
    if (!handleTextInput) throw new Error('Expected autolink text-input handler');

    expect(
      handleTextInput.call(plugin, view, url.length + 1, url.length + 1, ' ', () =>
        state.tr.insertText(' ', url.length + 1),
      ),
    ).toBe(false);
    expect(linkMarkType.isInSet(state.doc.firstChild?.firstChild?.marks ?? [])?.attrs.href).toBe(
      url,
    );
  });

  it('autolinks multi-character input replacing a selection', () => {
    vi.useFakeTimers();
    const url = 'https://example.com/replaced-selection';
    const insertedText = `${url} `;
    const initialDoc = schema.node(
      'doc',
      null,
      paragraphType.create(null, schema.text('selected text')),
    );
    let state = EditorState.create({
      schema,
      doc: initialDoc,
      selection: TextSelection.create(initialDoc, 1, 'selected text'.length + 1),
    });
    const view = {
      isDestroyed: false,
      get state() {
        return state;
      },
      dispatch(transaction: Transaction) {
        state = state.apply(transaction);
      },
    } as unknown as EditorView;
    const plugin = createAutolinkTypingPlugin();
    const handler = plugin.props.handleDOMEvents?.beforeinput;
    if (!handler) throw new Error('Expected deferred autolink handler');

    handler.call(plugin, view, {
      inputType: 'insertText',
      data: insertedText,
    } as InputEvent);
    const completedDoc = schema.node(
      'doc',
      null,
      paragraphType.create(null, schema.text(insertedText)),
    );
    state = EditorState.create({
      schema,
      doc: completedDoc,
      selection: TextSelection.create(completedDoc, 1 + insertedText.length),
    });

    vi.runAllTimers();
    vi.useRealTimers();
    expect(linkMarkType.isInSet(state.doc.firstChild?.firstChild?.marks ?? [])?.attrs.href).toBe(
      url,
    );
  });

  it('autolinks composition input after ProseMirror settles the cursor', () => {
    vi.useFakeTimers();
    const url = 'https://example.com/composition';
    const completedDoc = schema.node(
      'doc',
      null,
      paragraphType.create(null, schema.text(`${url} `)),
    );
    let state = EditorState.create({
      schema,
      doc: completedDoc,
      selection: TextSelection.create(completedDoc, url.length + 2),
    });
    const view = {
      isDestroyed: false,
      get state() {
        return state;
      },
      dispatch(transaction: Transaction) {
        state = state.apply(transaction);
      },
    } as unknown as EditorView;
    const plugin = createAutolinkTypingPlugin();
    const compositionend = plugin.props.handleDOMEvents?.compositionend;
    if (!compositionend) throw new Error('Expected autolink composition handler');

    compositionend.call(plugin, view, new CompositionEvent('compositionend', { data: `${url} ` }));
    vi.runAllTimers();
    vi.useRealTimers();
    expect(linkMarkType.isInSet(state.doc.firstChild?.firstChild?.marks ?? [])?.attrs.href).toBe(
      url,
    );
  });

  it('marks a typed URL before native delimiter insertion', () => {
    const url = 'https://example.com/typed';
    const doc = schema.node('doc', null, paragraphType.create(null, schema.text(url)));
    let state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, url.length + 1),
    });
    const view = {
      get state() {
        return state;
      },
      dispatch(transaction: Transaction) {
        state = state.apply(transaction);
      },
    } as unknown as EditorView;

    expect(handleAutolinkTextInput(view, url.length + 1, url.length + 1, ' ')).toBe(true);
    expect(linkMarkType.isInSet(state.doc.firstChild?.firstChild?.marks ?? [])?.attrs.href).toBe(
      url,
    );
  });

  it('marks a typed URL longer than 500 characters', () => {
    const prefix = 'word '.repeat(200);
    const url = `https://example.com/${'path/'.repeat(125)}`;
    const text = `${prefix}${url}`;
    const doc = schema.node('doc', null, paragraphType.create(null, schema.text(text)));
    let state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, text.length + 1),
    });
    const view = {
      get state() {
        return state;
      },
      dispatch(transaction: Transaction) {
        state = state.apply(transaction);
      },
    } as unknown as EditorView;

    expect(handleAutolinkTextInput(view, text.length + 1, text.length + 1, ' ')).toBe(true);
    const link = state.doc.firstChild?.lastChild;
    expect(linkMarkType.isInSet(link?.marks ?? [])?.attrs.href).toBe(url);
  });

  it('marks a URL after multi-character or composition input commits its delimiter', () => {
    const url = 'https://example.com/completed-input';
    const doc = schema.node('doc', null, paragraphType.create(null, schema.text(`${url} `)));
    let state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, url.length + 2),
    });
    const view = {
      get state() {
        return state;
      },
      dispatch(transaction: Transaction) {
        state = state.apply(transaction);
      },
    } as unknown as EditorView;

    expect(handleAutolinkCompletedInput(view)).toBe(true);
    expect(linkMarkType.isInSet(state.doc.firstChild?.firstChild?.marks ?? [])?.attrs.href).toBe(
      url,
    );
  });

  it('does not finalize an earlier URL when text follows it before Enter', () => {
    const text = 'Visit https://example.com later';
    const doc = schema.node('doc', null, paragraphType.create(null, schema.text(text)));
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, text.length + 1),
    });
    const dispatch = vi.fn();

    expect(
      handleAutolinkEnter(
        { state, dispatch } as unknown as EditorView,
        { key: 'Enter', shiftKey: false } as KeyboardEvent,
      ),
    ).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not finalize a malformed-prefix URL when Enter is pressed', () => {
    const text = 'abchttps://example.com';
    const doc = schema.node('doc', null, paragraphType.create(null, schema.text(text)));
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, text.length + 1),
    });
    const dispatch = vi.fn();

    expect(
      handleAutolinkEnter(
        { state, dispatch } as unknown as EditorView,
        { key: 'Enter', shiftKey: false } as KeyboardEvent,
      ),
    ).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not overwrite an existing URL-text link when Enter is pressed', () => {
    const url = 'https://example.com/existing-link';
    const doc = schema.node(
      'doc',
      null,
      paragraphType.create(
        null,
        schema.text(url, [linkMarkType.create({ href: 'https://target.example' })]),
      ),
    );
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, url.length + 1),
    });
    const dispatch = vi.fn();

    expect(
      handleAutolinkEnter(
        { state, dispatch } as unknown as EditorView,
        { key: 'Enter', shiftKey: false } as KeyboardEvent,
      ),
    ).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects link and code-marked ranges for delimiter-triggered autolinking', () => {
    const url = 'https://example.com/marked';
    const linkedDoc = schema.node(
      'doc',
      null,
      paragraphType.create(
        null,
        schema.text(url, [linkMarkType.create({ href: 'https://target.example' })]),
      ),
    );
    const codeDoc = schema.node(
      'doc',
      null,
      paragraphType.create(null, schema.text(url, [codeMarkType.create()])),
    );

    expect(isEligibleAutolinkRange(linkedDoc, 1, url.length + 1, linkMarkType)).toBe(false);
    expect(isEligibleAutolinkRange(codeDoc, 1, url.length + 1, linkMarkType)).toBe(false);
  });

  it('accepts an unmarked text range for delimiter-triggered autolinking', () => {
    const url = 'https://example.com/unmarked';
    const doc = schema.node('doc', null, paragraphType.create(null, schema.text(url)));

    expect(isEligibleAutolinkRange(doc, 1, url.length + 1, linkMarkType)).toBe(true);
  });

  it.each([
    mathInlineType,
    tagType,
  ])('does not link a URL interrupted by an inline %s atom', (atomType) => {
    const doc = schema.node(
      'doc',
      null,
      paragraphType.create(null, [
        schema.text('https://exa'),
        atomType.create(),
        schema.text('mple.com'),
      ]),
    );
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, doc.content.size - 1),
    });
    const dispatch = vi.fn();

    expect(
      handleAutolinkEnter(
        { state, dispatch } as unknown as EditorView,
        { key: 'Enter', shiftKey: false } as KeyboardEvent,
      ),
    ).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('repairs only canonical URLs outside inline and fenced code', () => {
    const code = codeMarkType.create();
    const doc = schema.node('doc', null, [
      paragraphType.create(null, [
        schema.text('example.com/path, '),
        schema.text('https://inline-code.example', [code]),
      ]),
      codeBlockType.create(null, schema.text('https://code-block.example')),
    ]);
    let state = EditorState.create({ schema, doc });
    const view = {
      get state() {
        return state;
      },
      dispatch(transaction: Transaction) {
        state = state.apply(transaction);
      },
    } as unknown as EditorView;

    repairDocument(view);

    const repairedUrl = state.doc.firstChild?.firstChild;
    const inlineCodeUrl = state.doc.firstChild?.lastChild;
    const fencedCodeUrl = state.doc.lastChild?.firstChild;
    expect(linkMarkType.isInSet(repairedUrl?.marks ?? [])?.attrs.href).toBe(
      'https://example.com/path',
    );
    expect(linkMarkType.isInSet(inlineCodeUrl?.marks ?? [])).toBeUndefined();
    expect(linkMarkType.isInSet(fencedCodeUrl?.marks ?? [])).toBeUndefined();
  });

  it('repairs a URL split across formatting marks with one normalized href', () => {
    const strong = strongMarkType.create();
    const emphasis = emphasisMarkType.create();
    const href = 'https://example.com/formatting-split';
    const doc = schema.node(
      'doc',
      null,
      paragraphType.create(null, [
        schema.text('https://exa', [strong]),
        schema.text('mple.com/', [emphasis]),
        schema.text('formatting-split'),
      ]),
    );
    let state = EditorState.create({ schema, doc });
    const view = {
      get state() {
        return state;
      },
      dispatch(transaction: Transaction) {
        state = state.apply(transaction);
      },
    } as unknown as EditorView;

    repairDocument(view);

    state.doc.firstChild?.forEach((node) => {
      expect(linkMarkType.isInSet(node.marks)?.attrs.href).toBe(href);
    });
  });

  it('does not repair unmarked text contiguous with an existing link token', () => {
    const existingLink = linkMarkType.create({ href: 'https://target.example' });
    const doc = schema.node(
      'doc',
      null,
      paragraphType.create(null, [
        schema.text('https://', [existingLink]),
        schema.text('example.com'),
      ]),
    );
    let state = EditorState.create({ schema, doc });
    const view = {
      get state() {
        return state;
      },
      dispatch(transaction: Transaction) {
        state = state.apply(transaction);
      },
    } as unknown as EditorView;

    repairDocument(view);

    expect(linkMarkType.isInSet(state.doc.firstChild?.lastChild?.marks ?? [])).toBeUndefined();
  });
});
