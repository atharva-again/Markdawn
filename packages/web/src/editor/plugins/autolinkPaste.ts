import {
  Fragment,
  type Mark,
  type MarkType,
  type Node as ProseMirrorNode,
  Slice,
} from '@milkdown/kit/prose/model';
import { Plugin } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { findHttpUrlsInTextRun } from '../utils/textRunUrls';
import type { UrlPasteIntent } from '../utils/urlPaste';

function isCodeContext(view: EditorView): boolean {
  const { selection, storedMarks } = view.state;
  const { $from } = selection;
  if ($from.parent.type.spec.code === true || $from.marks().some((mark) => mark.type.spec.code)) {
    return true;
  }
  if (storedMarks?.some((mark) => mark.type.spec.code)) return true;

  const { from, to } = selection;
  let hasCode = false;
  view.state.doc.nodesBetween(from, to, (node) => {
    if (node.type.spec.code || node.marks.some((mark) => mark.type.spec.code)) {
      hasCode = true;
      return false;
    }
    return !hasCode;
  });
  return hasCode;
}

function linkifyTextRun(
  nodes: readonly ProseMirrorNode[],
  linkMarkType: MarkType,
  context: string,
): ProseMirrorNode[] {
  const matches = findHttpUrlsInTextRun(nodes, context);
  if (matches.length === 0) return [...nodes];
  const result: ProseMirrorNode[] = [];
  let runOffset = 0;
  let matchIndex = 0;

  for (const node of nodes) {
    const nodeEnd = runOffset + node.nodeSize;
    let nodeOffset = 0;
    while (nodeOffset < node.nodeSize) {
      while (true) {
        const currentMatch = matches[matchIndex];
        if (!currentMatch || currentMatch.to > runOffset + nodeOffset) break;
        matchIndex += 1;
      }
      const match = matches[matchIndex];
      if (!match || match.from >= nodeEnd) {
        result.push(node.cut(nodeOffset));
        break;
      }
      const matchStart = Math.max(match.from - runOffset, nodeOffset);
      if (matchStart > nodeOffset) result.push(node.cut(nodeOffset, matchStart));
      const matchEnd = Math.min(match.to - runOffset, node.nodeSize);
      result.push(
        node
          .cut(matchStart, matchEnd)
          .mark(linkMarkType.create({ href: match.href }).addToSet(node.marks)),
      );
      nodeOffset = matchEnd;
    }
    runOffset = nodeEnd;
  }
  return result;
}

function linkifyFragment(fragment: Fragment, linkMarkType: MarkType): Fragment {
  const children: ProseMirrorNode[] = [];
  let textRun: ProseMirrorNode[] = [];
  let textRunContext = '';
  const flushTextRun = () => {
    if (textRun.length === 0) return;
    children.push(...linkifyTextRun(textRun, linkMarkType, textRunContext));
    textRun = [];
    textRunContext = '';
  };

  fragment.forEach((node) => {
    if (
      node.isText &&
      !node.marks.some((mark) => mark.type === linkMarkType || mark.type.spec.code)
    ) {
      textRun.push(node);
      return;
    }
    flushTextRun();
    if (node.isText && node.marks.some((mark) => mark.type === linkMarkType)) {
      textRunContext += node.text ?? '';
      children.push(node);
      return;
    }
    textRunContext = '';
    if (node.type.spec.code || node.content.size === 0) {
      children.push(node);
      return;
    }
    children.push(node.copy(linkifyFragment(node.content, linkMarkType)));
  });
  flushTextRun();
  return Fragment.fromArray(children);
}

function applyStoredMarks(fragment: Fragment, storedMarks: readonly Mark[]): Fragment {
  const children: ProseMirrorNode[] = [];
  fragment.forEach((node) => {
    if (node.isText) {
      let marks = node.marks;
      for (const mark of storedMarks) marks = mark.addToSet(marks);
      children.push(node.mark(marks));
      return;
    }
    if (node.type.spec.code || node.content.size === 0) {
      children.push(node);
      return;
    }
    children.push(node.copy(applyStoredMarks(node.content, storedMarks)));
  });
  return Fragment.fromArray(children);
}

export function linkifyPastedSlice(slice: Slice, linkMarkType: MarkType): Slice {
  return new Slice(linkifyFragment(slice.content, linkMarkType), slice.openStart, slice.openEnd);
}

/** Handles a classified URL paste; clipboard parsing belongs to the paste router. */
export function handleUrlPasteIntent(view: EditorView, intent: UrlPasteIntent): boolean {
  const linkMarkType = view.state.schema.marks.link;
  if (!linkMarkType) return false;
  if (isCodeContext(view)) return false;

  if (intent.kind === 'uri-list') {
    const paragraphType = view.state.schema.nodes.paragraph;
    if (!paragraphType) return false;
    const activeMarks = (view.state.storedMarks ?? view.state.selection.$from.marks()).filter(
      (mark) => mark.type !== linkMarkType,
    );
    const paragraphs = intent.urls.map((url) =>
      paragraphType.create(null, view.state.schema.text(url, activeMarks)),
    );
    view.dispatch(
      view.state.tr
        .replaceSelection(
          linkifyPastedSlice(Slice.maxOpen(Fragment.fromArray(paragraphs)), linkMarkType),
        )
        .scrollIntoView()
        .setMeta('paste', true)
        .setMeta('uiEvent', 'paste'),
    );
    return true;
  }

  const { selection } = view.state;
  if (!selection.$from.parent.type.allowsMarkType(linkMarkType)) return false;
  if (selection.empty) {
    if (intent.source !== 'uri-list') return false;
    const activeMarks = view.state.storedMarks ?? selection.$from.marks();
    const marks = linkMarkType.create({ href: intent.url }).addToSet(activeMarks);
    view.dispatch(
      view.state.tr
        .replaceSelectionWith(view.state.schema.text(intent.url, marks), false)
        .scrollIntoView()
        .setMeta('paste', true)
        .setMeta('uiEvent', 'paste'),
    );
    return true;
  }
  view.dispatch(
    view.state.tr
      .removeMark(selection.from, selection.to, linkMarkType)
      .addMark(selection.from, selection.to, linkMarkType.create({ href: intent.url }))
      .scrollIntoView(),
  );
  return true;
}

export function createAutolinkPastePlugin(linkMarkType: MarkType): Plugin {
  return new Plugin({
    props: {
      transformPasted: (slice, view, plain) => {
        if (isCodeContext(view)) return slice;
        const storedMarks = (view.state.storedMarks ?? []).filter(
          (mark) => mark.type !== linkMarkType,
        );
        const markedSlice =
          plain && storedMarks.length > 0
            ? new Slice(
                applyStoredMarks(slice.content, storedMarks),
                slice.openStart,
                slice.openEnd,
              )
            : slice;
        return linkifyPastedSlice(markedSlice, linkMarkType);
      },
    },
  });
}
