import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type { Node as UnistNode } from 'unist';
import * as Y from 'yjs';
import { normalizeWikiLinkLookupKey } from './wikiLink.js';

// Reference-counted console.warn suppression for a harmless Yjs warning
// that fires when pushing to detached XmlElements during doc construction.
// The ref count ensures concurrent callers don't restore warn prematurely.
let warnSuppressionCount = 0;
// biome-ignore lint/suspicious/noConsole: save original to intercept Yjs library warnings during doc construction
const originalWarn = console.warn;

function suppressYjsWarn(): void {
  if (warnSuppressionCount === 0) {
    console.warn = (...args: unknown[]) => {
      const msg = args[0];
      if (
        typeof msg === 'string' &&
        msg.includes('Add Yjs type to a document before reading data')
      ) {
        return;
      }
      originalWarn.apply(console, args);
    };
  }
  warnSuppressionCount++;
}

function restoreWarn(): void {
  warnSuppressionCount--;
  if (warnSuppressionCount === 0) {
    console.warn = originalWarn;
  }
}

/**
 * Converts markdown text to a Yjs-encoded binary state that Milkdown's
 * collab plugin can render. Uses remark-math to parse $...$ and $$...$$
 * expressions into proper math nodes.
 *
 * Node names: paragraph, heading, code_block, blockquote, bullet_list,
 * ordered_list, list_item, hr, hard_break, image, math_inline, math
 *
 * Mark names: strong, emphasis, inlineCode, link, strike_through
 */
export function markdownToYjsState(markdown: string): Uint8Array {
  const doc = new Y.Doc();

  suppressYjsWarn();
  try {
    doc.transact(() => {
      const fragment = doc.getXmlFragment('prosemirror');

      // Parse markdown with remark-math support
      const ast = unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(markdown);

      // Process the AST and convert to Yjs nodes
      for (const node of ast.children) {
        const yNode = unistToYNode(node);
        if (yNode) {
          fragment.push([yNode]);
        }
      }
    });

    return Y.encodeStateAsUpdate(doc);
  } finally {
    restoreWarn();
  }
}

/**
 * Creates a Yjs document binary with both a title text field and body content.
 *
 * The Yjs doc has two top-level types:
 *   - "title" → Y.Text (page title, independent of any H1 in body)
 *   - "prosemirror" → XmlFragment (body content)
 */
export function createYjsDocWithTitle(title: string, markdown: string): Uint8Array {
  const doc = new Y.Doc();

  suppressYjsWarn();
  try {
    doc.transact(() => {
      doc.getText('title').insert(0, title || 'Untitled');
      const fragment = doc.getXmlFragment('prosemirror');
      const ast = unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(markdown);
      for (const node of ast.children) {
        const yNode = unistToYNode(node);
        if (yNode) {
          fragment.push([yNode]);
        }
      }
    });
    return Y.encodeStateAsUpdate(doc);
  } finally {
    restoreWarn();
  }
}

export function createEmptyYjsDoc(title: string): Uint8Array {
  return createYjsDocWithTitle(title, '');
}

/** Bind uniquely resolved links without retaining the target title in shared content. */
export function bindWikiLinkTargets(
  ydocBinary: Uint8Array,
  pageLookup: ReadonlyMap<string, string>,
): Uint8Array {
  const doc = new Y.Doc();
  const visit = (element: Y.XmlFragment | Y.XmlElement): void => {
    for (let index = 0; index < element.length; index++) {
      const item = element.get(index);
      if (!(item instanceof Y.XmlElement)) continue;
      if (item.nodeName === 'wikiLink') {
        const authoredPath = item.getAttribute('path') || '';
        const targetId = pageLookup.get(normalizeWikiLinkLookupKey(authoredPath));
        if (targetId) {
          const hashIndex = authoredPath.indexOf('#');
          const heading = hashIndex >= 0 ? authoredPath.slice(hashIndex + 1) : '';
          const label = item.getAttribute('label') || '';
          item.setAttribute('targetId', targetId);
          item.setAttribute('path', '');
          item.setAttribute('label', label);
          if (heading) item.setAttribute('heading', heading);
        }
      }
      visit(item);
    }
  };

  try {
    Y.applyUpdate(doc, ydocBinary);
    doc.transact(() => visit(doc.getXmlFragment('prosemirror')));
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}

/**
 * Loads a Yjs document from binary and extracts the title text.
 * Returns 'Untitled' if no title field exists.
 */
export function extractTitleFromYjs(ydocBinary: Uint8Array): string {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, ydocBinary);
  const titleText = doc.getText('title');
  return titleText.toString() || 'Untitled';
}

/**
 * Strips a leading H1 heading from markdown content if it matches the title.
 * Used to avoid duplicating the title in both the DB title column and the content.
 */
export function stripLeadingH1(markdown: string, title: string): string {
  if (!title) return markdown;
  const h1Regex = /^#\s+(.+)\n?/;
  const match = markdown.match(h1Regex);
  if (match && match[1]?.trim() === title.trim()) {
    return markdown.slice(match[0].length);
  }
  return markdown;
}

function unistToYNode(node: UnistNode): Y.XmlElement | null {
  switch (node.type) {
    case 'heading':
      return createHeading(node as UnistHeading);
    case 'paragraph':
      return createParagraph(node as UnistParagraph);
    case 'code':
      return createCodeBlock(node as UnistCode);
    case 'blockquote':
      return createBlockquote(node as UnistBlockquote);
    case 'list':
      return createList(node as UnistList);
    case 'listItem':
      return createListItem(node as UnistListItem);
    case 'table':
      return createTable(node as UnistTable);
    case 'tableRow':
      return createTableRow(node as UnistTableRow, false, []);
    case 'tableCell':
      return createTableCell(node as UnistTableCell, false, null);
    case 'thematicBreak':
      return createHr();
    case 'math':
      // Block math ($$...$$) - convert to code_block with language LaTeX
      return createLatexBlock(node as UnistMath);
    case 'inlineMath':
      // Inline math ($...$) - create a paragraph with inline math node
      return createInlineMathParagraph(node as UnistInlineMath);
    default:
      if ('value' in node && typeof node.value === 'string' && node.value.trim()) {
        return createParagraphFromText(node.value.trim());
      }
      return null;
  }
}

interface UnistHeading extends UnistNode {
  type: 'heading';
  depth: number;
  children: UnistNode[];
}

interface UnistParagraph extends UnistNode {
  type: 'paragraph';
  children: UnistNode[];
}

interface UnistCode extends UnistNode {
  type: 'code';
  lang?: string | null;
  value: string;
}

interface UnistBlockquote extends UnistNode {
  type: 'blockquote';
  children: UnistNode[];
}

interface UnistList extends UnistNode {
  type: 'list';
  ordered?: boolean;
  start?: number | null;
  spread?: boolean | null;
  children: UnistListItem[];
}

interface UnistListItem extends UnistNode {
  type: 'listItem';
  children: UnistNode[];
  checked?: boolean | null;
}

interface UnistTable extends UnistNode {
  type: 'table';
  children: UnistTableRow[];
  align?: (string | null)[];
}

interface UnistTableRow extends UnistNode {
  type: 'tableRow';
  children: UnistTableCell[];
  isHeader?: boolean;
  align?: (string | null)[];
}

interface UnistTableCell extends UnistNode {
  type: 'tableCell';
  children: UnistNode[];
  isHeader?: boolean;
  align?: string | null;
}

interface UnistMath extends UnistNode {
  type: 'math';
  value: string;
}

interface UnistInlineMath extends UnistNode {
  type: 'inlineMath';
  value: string;
}

function createHeading(node: UnistHeading): Y.XmlElement {
  const el = new Y.XmlElement('heading');
  el.setAttribute('level', String(node.depth));
  const content = unistInlineToYContent(node.children);
  for (const item of content) {
    if (item instanceof Y.XmlText || item instanceof Y.XmlElement) {
      el.push([item]);
    }
  }
  return el;
}

function createParagraph(node: UnistParagraph): Y.XmlElement {
  const el = new Y.XmlElement('paragraph');
  const content = unistInlineToYContent(node.children);
  // Filter out Y.XmlText that are empty and push both text and elements
  for (const item of content) {
    if (item instanceof Y.XmlText || item instanceof Y.XmlElement) {
      el.push([item]);
    }
  }
  return el;
}

function createParagraphFromText(text: string): Y.XmlElement {
  const el = new Y.XmlElement('paragraph');
  if (text) {
    el.push([new Y.XmlText(text)]);
  }
  return el;
}

function createCodeBlock(node: UnistCode): Y.XmlElement {
  const el = new Y.XmlElement('code_block');
  el.setAttribute('language', node.lang ?? '');
  el.push([new Y.XmlText(node.value)]);
  return el;
}

function createLatexBlock(node: UnistMath): Y.XmlElement {
  // Block math ($$...$$) becomes a code_block with language "LaTeX"
  // This matches how the Milkdown math plugin handles block math
  const el = new Y.XmlElement('code_block');
  el.setAttribute('language', 'LaTeX');
  el.push([new Y.XmlText(node.value)]);
  return el;
}

function createInlineMathParagraph(node: UnistInlineMath): Y.XmlElement {
  // Inline math ($...$) becomes a paragraph with a math_inline node
  const el = new Y.XmlElement('paragraph');
  const mathNode = new Y.XmlElement('math_inline');
  mathNode.setAttribute('value', node.value);
  el.push([mathNode]);
  return el;
}

function createBlockquote(node: UnistBlockquote): Y.XmlElement {
  const el = new Y.XmlElement('blockquote');
  for (const child of node.children) {
    if (child.type === 'paragraph') {
      el.push([createParagraph(child as UnistParagraph)]);
    } else {
      const yNode = unistToYNode(child);
      if (yNode) el.push([yNode]);
    }
  }
  return el;
}

function createList(node: UnistList): Y.XmlElement {
  const tagName = node.ordered ? 'ordered_list' : 'bullet_list';
  const el = new Y.XmlElement(tagName);
  if (node.ordered && node.start != null && node.start !== 1) {
    el.setAttribute('order', String(node.start));
  }

  for (const item of node.children) {
    el.push([createListItem(item)]);
  }

  return el;
}

function createListItem(node: UnistListItem): Y.XmlElement {
  const listItem = new Y.XmlElement('list_item');

  if (typeof node.checked === 'boolean') {
    listItem.setAttribute('checked', String(node.checked));
  }

  for (const child of node.children) {
    if (child.type === 'paragraph') {
      listItem.push([createParagraph(child as UnistParagraph)]);
    } else if (child.type === 'list') {
      listItem.push([createList(child as UnistList)]);
    } else if (child.type === 'text') {
      const paragraph = new Y.XmlElement('paragraph');
      const content = unistInlineToYContent([child]);
      for (const item of content) {
        if (item instanceof Y.XmlText || item instanceof Y.XmlElement) {
          paragraph.push([item]);
        }
      }
      listItem.push([paragraph]);
    } else {
      const yNode = unistToYNode(child);
      if (yNode) {
        listItem.push([yNode]);
      }
    }
  }

  return listItem;
}

function createTable(node: UnistTable): Y.XmlElement {
  const el = new Y.XmlElement('table');
  const align = node.align ?? [];

  node.children.forEach((row, index) => {
    const isHeader = index === 0;
    const rowNode = createTableRow(row, isHeader, align);
    el.push([rowNode]);
  });

  return el;
}

function createTableRow(
  node: UnistTableRow,
  isHeader: boolean,
  align: (string | null)[],
): Y.XmlElement {
  const tagName = isHeader ? 'table_header_row' : 'table_row';
  const el = new Y.XmlElement(tagName);

  for (let i = 0; i < node.children.length; i++) {
    const cell = node.children[i];
    if (!cell) continue;
    const cellAlign = align[i] ?? null;
    el.push([createTableCell(cell, isHeader, cellAlign)]);
  }

  return el;
}

function createTableCell(
  node: UnistTableCell,
  isHeader: boolean,
  align: string | null,
): Y.XmlElement {
  const tagName = isHeader ? 'table_header' : 'table_cell';
  const el = new Y.XmlElement(tagName);
  if (align) {
    el.setAttribute('alignment', align);
  }

  const paragraph = new Y.XmlElement('paragraph');
  const content = unistInlineToYContent(node.children);

  for (const item of content) {
    if (item instanceof Y.XmlText || item instanceof Y.XmlElement) {
      paragraph.push([item]);
    }
  }

  el.push([paragraph]);
  return el;
}

interface UnistText extends UnistNode {
  type: 'text';
  value: string;
  children?: UnistNode[];
}

function createHr(): Y.XmlElement {
  return new Y.XmlElement('hr');
}

/**
 * Convert unist inline nodes to Yjs content (text or elements).
 * Handles nested marks like **_bold italic_**.
 */
function unistInlineToYContent(
  nodes: UnistNode[],
  marks: Record<string, unknown> = {},
): Array<Y.XmlText | Y.XmlElement> {
  const result: Array<Y.XmlText | Y.XmlElement> = [];

  for (const node of nodes) {
    switch (node.type) {
      case 'text': {
        const t = node as UnistText;
        result.push(...createInlineContentFromText(t.value, marks));
        break;
      }
      case 'strong': {
        const t = node as UnistStrong;
        const merged = { ...marks, strong: true };
        result.push(...unistInlineToYContent(t.children ?? [], merged));
        break;
      }
      case 'emphasis': {
        const t = node as UnistEmphasis;
        const merged = { ...marks, emphasis: true };
        result.push(...unistInlineToYContent(t.children ?? [], merged));
        break;
      }
      case 'inlineCode': {
        const t = node as UnistInlineCode;
        const merged = { ...marks, inlineCode: true };
        const ytext = new Y.XmlText(t.value);
        ytext.format(0, t.value.length, merged);
        result.push(ytext);
        break;
      }
      case 'delete': {
        const t = node as UnistDelete;
        const merged = { ...marks, strike_through: true };
        result.push(...unistInlineToYContent(t.children ?? [], merged));
        break;
      }
      case 'link': {
        const t = node as UnistLink;
        const linkAttrs = { href: t.url, title: t.title ?? '' };
        const merged = { ...marks, link: linkAttrs };
        result.push(...unistInlineToYContent(t.children ?? [], merged));
        break;
      }
      case 'image': {
        const t = node as UnistImage;
        const img = new Y.XmlElement('image');
        img.setAttribute('src', t.url);
        img.setAttribute('alt', t.alt || '');
        img.setAttribute('title', t.title || '');
        result.push(img);
        break;
      }
      case 'break': {
        const ytext = new Y.XmlText('\n');
        if (Object.keys(marks).length > 0) {
          ytext.format(0, 1, marks);
        }
        result.push(ytext);
        break;
      }
      case 'inlineMath': {
        // Inline math - create a math_inline element
        const t = node as UnistInlineMath;
        const mathNode = new Y.XmlElement('math_inline');
        mathNode.setAttribute('value', t.value);
        result.push(mathNode);
        break;
      }
      default: {
        if ('value' in node && typeof node.value === 'string') {
          const ytext = new Y.XmlText(node.value);
          if (Object.keys(marks).length > 0) {
            ytext.format(0, node.value.length, marks);
          }
          result.push(ytext);
        }
        break;
      }
    }
  }

  return result;
}

function createInlineContentFromText(
  text: string,
  marks: Record<string, unknown>,
): Array<Y.XmlText | Y.XmlElement> {
  const result: Array<Y.XmlText | Y.XmlElement> = [];
  const pattern = /\[\[([^\]|]+)(?:\|(.+?))?\]\]|#([a-zA-Z0-9_-]+)/g;

  let currentIndex = 0;
  let match: RegExpExecArray | null;

  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec pattern
  while ((match = pattern.exec(text)) !== null) {
    const start = match.index;

    if (start > currentIndex) {
      const plainText = text.slice(currentIndex, start);
      const ytext = createFormattedText(plainText, marks);
      if (ytext) {
        result.push(ytext);
      }
    }

    if (match[1]) {
      const path = match[1].trim();
      const label = (match[2] ?? '').trim();
      if (path.length > 0) {
        const wikiLink = new Y.XmlElement('wikiLink');
        wikiLink.setAttribute('path', path);
        wikiLink.setAttribute('label', label);
        result.push(wikiLink);
      } else {
        const raw = match[0];
        const ytext = createFormattedText(raw, marks);
        if (ytext) {
          result.push(ytext);
        }
      }
    } else if (match[3]) {
      const tagName = match[3];
      const tag = new Y.XmlElement('tag');
      tag.setAttribute('value', tagName);
      result.push(tag);
    }

    currentIndex = start + match[0].length;
  }

  if (currentIndex < text.length) {
    const trailingText = text.slice(currentIndex);
    const ytext = createFormattedText(trailingText, marks);
    if (ytext) {
      result.push(ytext);
    }
  }

  if (result.length === 0) {
    const ytext = createFormattedText(text, marks);
    if (ytext) {
      result.push(ytext);
    }
  }

  return result;
}

function createFormattedText(text: string, marks: Record<string, unknown>): Y.XmlText | null {
  if (text.length === 0) {
    return null;
  }

  const ytext = new Y.XmlText(text);
  if (Object.keys(marks).length > 0) {
    ytext.format(0, text.length, marks);
  }
  return ytext;
}

interface UnistStrong extends UnistNode {
  type: 'strong';
  children: UnistNode[];
}

interface UnistEmphasis extends UnistNode {
  type: 'emphasis';
  children: UnistNode[];
}

interface UnistInlineCode extends UnistNode {
  type: 'inlineCode';
  value: string;
}

interface UnistDelete extends UnistNode {
  type: 'delete';
  children: UnistNode[];
}

interface UnistLink extends UnistNode {
  type: 'link';
  url: string;
  title?: string | null;
  children: UnistNode[];
}

interface UnistImage extends UnistNode {
  type: 'image';
  url: string;
  alt?: string | null;
  title?: string | null;
}
