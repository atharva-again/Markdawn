import * as Y from 'yjs';
import { normalizeWikiLinkLookupKey } from './wikiLink.js';

export type ConnectionTargetType = 'page' | 'tag' | 'user' | 'external';
export type ConnectionType = 'wikilink' | 'tag' | 'mention' | 'embed' | 'heading' | 'url';

export interface ConnectionDraft {
  targetType: ConnectionTargetType;
  targetId?: string;
  targetSlug: string;
  targetLabel: string;
  connectionType: ConnectionType;
  linkText?: string;
  linkContext?: string;
}

// ---------------------------------------------------------------------------
// Markdown export
// ---------------------------------------------------------------------------

interface DeltaSegment {
  insert: string;
  attributes?: Record<string, unknown>;
}

const MARK_ORDER = ['strong', 'emphasis', 'inlineCode', 'strike_through'] as const;

const MARK_DELIMITERS: Record<string, [string, string]> = {
  strong: ['**', '**'],
  emphasis: ['*', '*'],
  inlineCode: ['`', '`'],
  strike_through: ['~~', '~~'],
};

export interface MarkdownRenderOptions {
  resolveWikiLinkTarget?: (targetId: string) => { title: string } | null;
  restrictedWikiLinkText?: string;
}

/** Exported for testing. */
export function yDocToMarkdown(update: Uint8Array, options: MarkdownRenderOptions = {}): string {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  const fragment = doc.getXmlFragment('prosemirror');
  return renderBlockChildren(fragment, 0, options);
}

// ---- Block rendering ----

function renderBlockChildren(
  element: Y.XmlFragment | Y.XmlElement,
  depth: number,
  options: MarkdownRenderOptions,
): string {
  let result = '';

  for (let i = 0; i < element.length; i++) {
    const child = element.get(i);

    if (child instanceof Y.XmlText) {
      // Block-level XmlText shouldn't happen in a valid prosemirror doc,
      // but handle it gracefully as inline content.
      result += renderDelta(child.toDelta() as DeltaSegment[]);
    } else if (child instanceof Y.XmlElement) {
      result += renderBlockElement(child, depth, options);
    }
  }

  return result;
}

function renderBlockElement(
  element: Y.XmlElement,
  depth: number,
  options: MarkdownRenderOptions,
): string {
  switch (element.nodeName) {
    case 'paragraph':
      return `${renderInlineContent(element, options)}\n\n`;

    case 'heading': {
      const level = Number.parseInt(element.getAttribute('level') || '1', 10);
      return `${'#'.repeat(Math.min(Math.max(level, 1), 6))} ${renderInlineContent(element, options)}\n\n`;
    }

    case 'code_block': {
      const lang = element.getAttribute('language') || '';
      const code = element.get(0);
      const codeText = code instanceof Y.XmlText ? code.toString() : '';
      return `\`\`\`${lang}\n${codeText}\n\`\`\`\n\n`;
    }

    case 'blockquote': {
      const inner = renderBlockChildren(element, depth + 1, options).replace(/\n\n$/, '');
      if (!inner.trim()) return '\n';
      const lines = inner.split('\n');
      return `${lines.map((l) => (l ? `> ${l}` : '>')).join('\n')}\n\n`;
    }

    case 'bullet_list':
      return renderList(element, depth, false, options);

    case 'ordered_list':
      return renderList(element, depth, true, options);

    case 'hr':
      return '---\n\n';

    case 'table':
      return renderTable(element, options);

    case 'callout':
      return renderCallout(element, depth, options);

    default:
      // Treat unknown block nodes as inline content
      return `${renderInlineContent(element, options)}\n\n`;
  }
}

// ---- List rendering ----

function renderList(
  element: Y.XmlElement,
  depth: number,
  ordered: boolean,
  options: MarkdownRenderOptions,
): string {
  const items: string[] = [];
  let counter = Number(element.getAttribute('order') || '1');
  const indent = '  '.repeat(depth);

  for (let i = 0; i < element.length; i++) {
    const child = element.get(i);
    if (!(child instanceof Y.XmlElement) || child.nodeName !== 'list_item') continue;

    const prefix = ordered ? `${counter}. ` : '- ';
    const checked = child.getAttribute('checked');
    const taskPrefix = checked != null ? (checked === 'true' ? '[x] ' : '[ ] ') : '';
    const itemContent = renderListItemContent(child, depth + 1, options);

    items.push(`${indent}${prefix}${taskPrefix}${itemContent.trimStart().trimEnd()}`);
    counter++;
  }

  return `${items.join('\n')}\n`;
}

function renderListItemContent(
  element: Y.XmlElement,
  depth: number,
  options: MarkdownRenderOptions,
): string {
  let result = '';

  for (let i = 0; i < element.length; i++) {
    const child = element.get(i);

    if (child instanceof Y.XmlText) {
      result += renderDelta(child.toDelta() as DeltaSegment[]);
    } else if (child instanceof Y.XmlElement) {
      switch (child.nodeName) {
        case 'paragraph':
          result += renderInlineContent(child, options);
          break;
        case 'bullet_list':
        case 'ordered_list':
          result += `\n${renderList(child, depth, child.nodeName === 'ordered_list', options)}`;
          break;
        default:
          result += renderBlockElement(child, depth, options);
      }
    }
  }

  return result;
}

// ---- Table rendering ----

function renderTable(element: Y.XmlElement, options: MarkdownRenderOptions): string {
  const rows: string[][] = [];
  const alignments: (string | null)[] = [];

  for (let i = 0; i < element.length; i++) {
    const row = element.get(i);
    if (!(row instanceof Y.XmlElement)) continue;

    const cells: string[] = [];
    for (let j = 0; j < row.length; j++) {
      const cell = row.get(j);
      if (!(cell instanceof Y.XmlElement)) continue;

      cells.push(renderInlineContent(cell, options));

      if (row.nodeName === 'table_header_row' && j >= alignments.length) {
        alignments.push(cell.getAttribute('alignment') || null);
      }
    }
    rows.push(cells);
  }

  if (rows.length === 0) return '';

  const numCols = Math.max(...rows.map((r) => r.length), alignments.length);
  while (alignments.length < numCols) alignments.push(null);

  const alignRow = alignments.map((a) => {
    if (a === 'center') return ':---:';
    if (a === 'right') return '---:';
    if (a === 'left') return ':---';
    return '---';
  });

  const lines = rows.map((row) => {
    while (row.length < numCols) row.push('');
    return `| ${row.join(' | ')} |`;
  });

  // Insert alignment row after first (header) row
  lines.splice(1, 0, `| ${alignRow.join(' | ')} |`);

  return `${lines.join('\n')}\n\n`;
}

// ---- Callout rendering ----

function renderCallout(
  element: Y.XmlElement,
  depth: number,
  options: MarkdownRenderOptions,
): string {
  const calloutType = (element.getAttribute('type') || 'note').toUpperCase();
  const title = element.getAttribute('title') || '';
  const titleSuffix = title ? ` ${title}` : '';
  const inner = renderBlockChildren(element, depth + 1, options).replace(/\n\n$/, '');

  if (!inner.trim()) return `> [!${calloutType}${titleSuffix}]\n\n`;

  const prefixInner = inner
    .split('\n')
    .map((l) => (l ? `> ${l}` : '>'))
    .join('\n');

  return `> [!${calloutType}${titleSuffix}]\n${prefixInner}\n\n`;
}

// ---- Inline content rendering ----

function renderInlineContent(
  element: Y.XmlFragment | Y.XmlElement,
  options: MarkdownRenderOptions,
): string {
  let result = '';

  for (let i = 0; i < element.length; i++) {
    const child = element.get(i);

    if (child instanceof Y.XmlText) {
      result += renderDelta(child.toDelta() as DeltaSegment[]);
    } else if (child instanceof Y.XmlElement) {
      result += renderInlineElement(child, options);
    }
  }

  return result;
}

function renderInlineElement(element: Y.XmlElement, options: MarkdownRenderOptions): string {
  switch (element.nodeName) {
    case 'image': {
      const src = element.getAttribute('src') || '';
      const alt = element.getAttribute('alt') || '';
      const title = element.getAttribute('title') || '';
      const titlePart = title ? ` "${title}"` : '';
      return `![${alt}](${src}${titlePart})`;
    }

    case 'hardbreak':
      return '\n';

    case 'wikiLink': {
      const targetId = element.getAttribute('targetId') || '';
      const resolvedTarget = targetId ? options.resolveWikiLinkTarget?.(targetId) : undefined;
      if (targetId && !resolvedTarget) {
        return options.restrictedWikiLinkText ?? 'Restricted page';
      }
      const path = resolvedTarget?.title ?? element.getAttribute('path') ?? '';
      const label = element.getAttribute('label') || '';
      const heading = element.getAttribute('heading') || '';
      // When imported via API, heading may be embedded in path (# suffix)
      const resolvedHeading = heading || extractHeadingFromPath(path);
      const resolvedPath =
        resolvedHeading && heading === '' && !element.getAttribute('heading')
          ? path.split('#')[0] || path
          : path;
      const target = resolvedHeading ? `${resolvedPath}#${resolvedHeading}` : resolvedPath;

      if (label) {
        return `[[${target}|${label}]]`;
      }
      return `[[${target}]]`;
    }

    case 'tag': {
      // Editor uses "name", API import uses "value" — check both
      const name = element.getAttribute('name') || element.getAttribute('value') || '';
      return name ? `#${name}` : '';
    }

    case 'math_inline': {
      const value = element.getAttribute('value') || '';
      return `$${value}$`;
    }

    case 'html': {
      return element.getAttribute('value') || '';
    }

    case 'footnote_reference': {
      const label = element.getAttribute('label') || '';
      return `[^${label}]`;
    }

    default:
      return renderInlineContent(element, options);
  }
}

/**
 * Extracts heading reference from a path string like "Page Name#Heading".
 * Returns the heading part or empty string if no # separator is present.
 */
function extractHeadingFromPath(path: string): string {
  const hashIndex = path.indexOf('#');
  if (hashIndex === -1 || hashIndex === path.length - 1) return '';
  return path.slice(hashIndex + 1);
}

// ---- Delta / mark processing ----

function renderDelta(delta: DeltaSegment[]): string {
  if (delta.length === 0) return '';

  const hasLink = delta.some((seg) => seg.attributes && 'link' in seg.attributes);

  if (!hasLink) {
    return renderDeltaMarks(delta, new Set());
  }

  // Group consecutive segments by link href for [text](url) structure
  return renderDeltaWithLinks(delta);
}

function renderDeltaWithLinks(delta: DeltaSegment[]): string {
  const groups: { href: string | null; segments: DeltaSegment[] }[] = [];
  let currentGroup: { href: string | null; segments: DeltaSegment[] } | null = null;

  for (const seg of delta) {
    const href = getLinkHref(seg);
    if (!currentGroup || currentGroup.href !== href) {
      currentGroup = { href, segments: [] };
      groups.push(currentGroup);
    }
    currentGroup.segments.push(seg);
  }

  return groups
    .map((group) => {
      if (group.href) {
        const inner = renderDeltaMarks(group.segments, new Set(['link']));
        return `[${inner}](${group.href})`;
      }
      return renderDeltaMarks(group.segments, new Set(['link']));
    })
    .join('');
}

function getLinkHref(seg: DeltaSegment): string | null {
  const linkAttr = seg.attributes?.link;
  if (linkAttr && typeof linkAttr === 'object') {
    const href = (linkAttr as Record<string, string>).href;
    return href || null;
  }
  return null;
}

function renderDeltaMarks(segments: DeltaSegment[], excludeMarks: Set<string>): string {
  let result = '';
  const active: string[] = [];
  const markOrder = MARK_ORDER as readonly string[];

  for (const seg of segments) {
    const segMarks = Object.keys(seg.attributes || {}).filter(
      (m) => !excludeMarks.has(m) && MARK_DELIMITERS[m],
    );

    // Close marks that ended (reverse order for correct nesting)
    for (let i = active.length - 1; i >= 0; i--) {
      const mark = active[i] as string;
      if (!segMarks.includes(mark)) {
        const delim = MARK_DELIMITERS[mark];
        if (delim) result += delim[1];
        active.splice(i, 1);
      }
    }

    // Open new marks (in canonical order)
    const toOpen = segMarks.filter((m) => !active.includes(m));
    toOpen.sort((a, b) => markOrder.indexOf(a) - markOrder.indexOf(b));
    for (const mark of toOpen) {
      result += MARK_DELIMITERS[mark]?.[0];
      active.push(mark);
    }

    result += seg.insert;
  }

  // Close remaining marks (reverse order)
  for (let i = active.length - 1; i >= 0; i--) {
    result += MARK_DELIMITERS[active[i] as string]?.[1];
  }

  return result;
}

// ---------------------------------------------------------------------------
// Connection extraction (unchanged)
// ---------------------------------------------------------------------------

export function extractConnectionsFromYDoc(update: Uint8Array): ConnectionDraft[] {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  const fragment = doc.getXmlFragment('prosemirror');
  return extractConnectionsFromXml(fragment);
}

export function extractWikiLinkTargetIds(update: Uint8Array): string[] {
  const doc = new Y.Doc();
  const targetIds = new Set<string>();
  const visit = (element: Y.XmlFragment | Y.XmlElement): void => {
    for (let index = 0; index < element.length; index++) {
      const item = element.get(index);
      if (!(item instanceof Y.XmlElement)) continue;
      if (item.nodeName === 'wikiLink') {
        const targetId = item.getAttribute('targetId');
        if (targetId) targetIds.add(targetId);
      }
      visit(item);
    }
  };
  try {
    Y.applyUpdate(doc, update);
    visit(doc.getXmlFragment('prosemirror'));
    return [...targetIds];
  } finally {
    doc.destroy();
  }
}

function extractConnectionsFromXml(element: Y.XmlFragment | Y.XmlElement): ConnectionDraft[] {
  const connections: ConnectionDraft[] = [];

  for (let i = 0; i < element.length; i++) {
    const item = element.get(i);
    if (!(item instanceof Y.XmlElement)) continue;

    const context = xmlElementPlainText(item).trim();
    collectConnections(item, context, connections);
  }

  return connections;
}

function collectConnections(
  element: Y.XmlElement,
  context: string,
  connections: ConnectionDraft[],
): void {
  for (let i = 0; i < element.length; i++) {
    const item = element.get(i);
    if (!(item instanceof Y.XmlElement)) continue;

    if (item.nodeName === 'wikiLink') {
      const path = item.getAttribute('path') || '';
      const label = item.getAttribute('label') || '';
      const targetId = item.getAttribute('targetId') || '';
      const heading = item.getAttribute('heading') || '';
      const target = heading ? `${path}#${heading}` : path;
      const targetSlug = path
        ? normalizeWikiLinkLookupKey(path)
        : targetId
          ? `id:${targetId.toLowerCase()}`
          : '';

      if (targetSlug) {
        const draft: ConnectionDraft = {
          targetType: 'page',
          targetSlug,
          targetLabel: target || label || 'Wiki link',
          connectionType: heading ? 'heading' : 'wikilink',
          linkText: label || target || 'Wiki link',
        };
        if (targetId) draft.targetId = targetId;
        if (context) draft.linkContext = context;
        connections.push(draft);
      }
      continue;
    }

    if (item.nodeName === 'tag') {
      const name = item.getAttribute('name') || item.getAttribute('value') || '';
      const tagSlug = normalizeTagSlug(name);
      if (tagSlug) {
        connections.push({
          targetType: 'tag',
          targetSlug: tagSlug,
          targetLabel: tagSlug,
          connectionType: 'tag',
          linkText: tagSlug,
          ...(context ? { linkContext: context } : {}),
        });
      }
      continue;
    }

    collectConnections(item, context, connections);
  }
}

function xmlElementPlainText(element: Y.XmlFragment | Y.XmlElement): string {
  let text = '';

  for (let i = 0; i < element.length; i++) {
    const item = element.get(i);
    if (item instanceof Y.XmlText) {
      text += item.toString();
      continue;
    }

    if (!(item instanceof Y.XmlElement)) continue;

    if (item.nodeName === 'wikiLink') {
      const label = item.getAttribute('label') || item.getAttribute('path') || 'Wiki link';
      text += label;
      continue;
    }

    if (item.nodeName === 'tag') {
      const name = item.getAttribute('name') || item.getAttribute('value') || '';
      text += name ? `#${name}` : '';
      continue;
    }

    text += xmlElementPlainText(item);
  }

  return text;
}

// ---------------------------------------------------------------------------
// Misc utilities (unchanged)
// ---------------------------------------------------------------------------

export function normalizePageSlug(value: string): string {
  return normalizeWikiLinkLookupKey(value);
}

export function normalizeTagSlug(value: string): string {
  const trimmed = value.trim().replace(/^#+/, '').toLowerCase();
  return trimmed ? `#${trimmed}` : '';
}

const WIKILINK_REGEX = /(?<!!)\[\[([^#|\]]+)(?:#(\^[^|]+)|#([^|\]]+))?(?:\|([^\]]+))?\]\]/g;

export interface WikilinkMatch {
  page: string;
  blockId: string | undefined;
  heading: string | undefined;
  alias: string | undefined;
}

export function extractWikilinks(content: string): WikilinkMatch[] {
  const results: WikilinkMatch[] = [];
  let match: RegExpExecArray | null;

  WIKILINK_REGEX.lastIndex = 0;

  while (true) {
    match = WIKILINK_REGEX.exec(content);
    if (match === null) break;

    const page = match[1];
    if (!page) continue;

    results.push({
      page: page.trim(),
      blockId: match[2]?.trim(),
      heading: match[3]?.trim(),
      alias: match[4]?.trim(),
    });
  }
  return results;
}
