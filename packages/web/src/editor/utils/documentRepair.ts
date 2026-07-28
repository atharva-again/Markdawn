import type { MarkType, NodeType, Node as ProseNode } from '@milkdown/kit/prose/model';
import { Fragment } from '@milkdown/kit/prose/model';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { getHttpUrlRangesInTextRun, type TextRunSegment } from './textRunUrls';

type TaskRepair = {
  itemPos: number;
  deleteFrom: number;
  deleteTo: number;
  checked: boolean;
  attrs: Record<string, unknown>;
};

const WIKI_PATTERN = /\[\[([^\]|#]*)(?:#([^\]|]+))?(?:\|(.+?))?\]\]/g;
const TAG_PATTERN = /(^|\s)#([A-Za-z0-9_-]+)(?=$|\s)/g;
const TASK_PREFIX_PATTERN = /^\[( |x|X)\]\s/;

function buildWikiNode(wikiLinkType: NodeType, source: string): ProseNode {
  const match = source.match(/^\[\[([^\]|#]*)(?:#([^\]|]+))?(?:\|(.+?))?\]\]$/);
  const path = match?.[1] ?? '';
  const heading = match?.[2] ?? '';
  const label = match?.[3] ?? '';

  return wikiLinkType.create({ path, heading, label });
}

function splitInlineText(
  text: string,
  schemaText: (text: string) => ProseNode,
  wikiLinkType: NodeType,
  tagType: NodeType,
): ProseNode[] {
  const nodes: ProseNode[] = [];
  let index = 0;

  while (index < text.length) {
    const wikiRegex = new RegExp(WIKI_PATTERN.source, 'g');
    wikiRegex.lastIndex = index;
    const wikiMatch = wikiRegex.exec(text);
    const wikiStart = wikiMatch ? wikiMatch.index : Number.POSITIVE_INFINITY;

    const tagRegex = new RegExp(TAG_PATTERN.source, 'g');
    tagRegex.lastIndex = index;
    const tagMatch = tagRegex.exec(text);
    const tagLeading = tagMatch?.[1] ?? '';
    const tagName = tagMatch?.[2] ?? '';
    const tagStart = tagMatch ? tagMatch.index + tagLeading.length : Number.POSITIVE_INFINITY;

    if (!wikiMatch && !tagMatch) {
      nodes.push(schemaText(text.slice(index)));
      break;
    }

    if (wikiStart <= tagStart && wikiMatch) {
      if (wikiStart > index) {
        nodes.push(schemaText(text.slice(index, wikiStart)));
      }

      const wikiText = wikiMatch[0] ?? '';
      if (wikiText) {
        nodes.push(buildWikiNode(wikiLinkType, wikiText));
        index = wikiStart + wikiText.length;
        continue;
      }
    } else {
      if (tagStart > index) {
        nodes.push(schemaText(text.slice(index, tagStart)));
      }

      if (tagName) {
        nodes.push(tagType.create({ name: tagName }));
        index = tagStart + 1 + tagName.length;
        continue;
      }
    }

    nodes.push(schemaText(text.slice(index)));
    break;
  }

  return nodes;
}

function findFirstTextInListItem(
  node: ProseNode,
  pos: number,
): { text: string; from: number } | null {
  let result: { text: string; from: number } | null = null;

  node.descendants((child, relPos) => {
    if (!child.isText || !child.text) return true;
    result = {
      text: child.text,
      from: pos + 1 + relPos,
    };
    return false;
  });

  return result;
}

function repairTaskItems(state: EditorState): Transaction | null {
  const taskRepairs: TaskRepair[] = [];

  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'list_item') return true;

    const firstText = findFirstTextInListItem(node, pos);
    if (firstText === null) return true;

    const match = firstText.text.match(TASK_PREFIX_PATTERN);
    if (!match) return true;

    const prefix = match[0];
    const checked = match[1]?.toLowerCase() === 'x';

    taskRepairs.push({
      itemPos: pos,
      deleteFrom: firstText.from,
      deleteTo: firstText.from + prefix.length,
      checked,
      attrs: node.attrs as Record<string, unknown>,
    });

    return true;
  });

  if (taskRepairs.length === 0) return null;

  const tr = state.tr;
  const sortedRepairs = taskRepairs.sort((a, b) => b.deleteFrom - a.deleteFrom);
  for (const repair of sortedRepairs) {
    tr.setNodeMarkup(repair.itemPos, undefined, {
      ...repair.attrs,
      checked: repair.checked,
    });
    tr.deleteRange(repair.deleteFrom, repair.deleteTo);
  }

  return tr.docChanged ? tr : null;
}

function repairInlineNodes(state: EditorState): Transaction | null {
  const wikiLinkType = state.schema.nodes.wikiLink;
  const tagType = state.schema.nodes.tag;

  if (!wikiLinkType || !tagType) return null;

  const replacements: Array<{ from: number; to: number; nodes: ProseNode[] }> = [];

  state.doc.descendants((node, pos, parent) => {
    if (!node.isText || !node.text) return true;
    if (parent?.type.spec.code) return true;

    const text = node.text;
    if (!WIKI_PATTERN.test(text) && !TAG_PATTERN.test(text)) {
      WIKI_PATTERN.lastIndex = 0;
      TAG_PATTERN.lastIndex = 0;
      return true;
    }
    WIKI_PATTERN.lastIndex = 0;
    TAG_PATTERN.lastIndex = 0;

    const nodes = splitInlineText(
      text,
      state.schema.text.bind(state.schema),
      wikiLinkType,
      tagType,
    );

    if (nodes.length === 1 && nodes[0]?.isText && nodes[0].text === text) {
      return true;
    }

    replacements.push({
      from: pos,
      to: pos + node.nodeSize,
      nodes,
    });

    return true;
  });

  if (replacements.length === 0) return null;

  const tr = state.tr;
  const sortedReplacements = replacements.sort((a, b) => b.from - a.from);
  for (const item of sortedReplacements) {
    tr.replaceWith(item.from, item.to, Fragment.fromArray(item.nodes));
  }

  return tr.docChanged ? tr : null;
}

function repairAutoLinks(state: EditorState): Transaction | null {
  const linkMarkType: MarkType | undefined = state.schema.marks.link;
  if (!linkMarkType) return null;

  const markRanges: Array<{ from: number; to: number; href: string }> = [];

  state.doc.descendants((node, pos) => {
    if (!node.isTextblock || node.type.spec.code) return true;

    let textRun: TextRunSegment[] = [];
    let textRunContext = '';
    const flushTextRun = () => {
      for (const range of getHttpUrlRangesInTextRun(textRun, textRunContext)) {
        if (!state.doc.rangeHasMark(range.from, range.to, linkMarkType)) {
          markRanges.push(range);
        }
      }
      textRun = [];
      textRunContext = '';
    };

    node.forEach((child, offset) => {
      if (
        child.isText &&
        child.text &&
        !child.marks.some((mark) => mark.type.spec.code || mark.type === linkMarkType)
      ) {
        textRun.push({ from: pos + 1 + offset, node: child });
        return;
      }
      flushTextRun();
      if (child.isText && child.marks.some((mark) => mark.type === linkMarkType)) {
        textRunContext += child.text ?? '';
        return;
      }
      textRunContext = '';
    });
    flushTextRun();
    return false;
  });

  if (markRanges.length === 0) return null;

  const tr = state.tr;
  const sortedRanges = markRanges.sort((a, b) => b.from - a.from);
  for (const range of sortedRanges) {
    tr.addMark(range.from, range.to, linkMarkType.create({ href: range.href }));
  }

  return tr.docChanged ? tr : null;
}

export function repairDocument(view: EditorView): void {
  let state = view.state;
  const transactions: Transaction[] = [];

  const taskTr = repairTaskItems(state);
  if (taskTr) {
    transactions.push(taskTr);
    state = state.apply(taskTr);
  }

  const inlineTr = repairInlineNodes(state);
  if (inlineTr) {
    transactions.push(inlineTr);
    state = state.apply(inlineTr);
  }

  const linkTr = repairAutoLinks(state);
  if (linkTr) {
    transactions.push(linkTr);
  }

  for (const tr of transactions) {
    view.dispatch(tr);
  }
}
