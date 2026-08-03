import type { Editor } from '@milkdown/core';
import { editorViewCtx } from '@milkdown/core';
import type { MarkType, NodeType } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import { isInTable } from 'prosemirror-tables';
import { type RefObject, useCallback, useState } from 'react';
import { isBlockquoteActive } from '../../editor/utils/blockquote';
import { getClosestListType } from './listCommands';

export type EditorActiveStates = {
  isBoldActive: boolean;
  isItalicActive: boolean;
  isStrikeActive: boolean;
  isCodeActive: boolean;
  isLinkActive: boolean;
  isBlockquoteActive: boolean;
  isH1Active: boolean;
  isH2Active: boolean;
  isH3Active: boolean;
  isH4Active: boolean;
  isH5Active: boolean;
  isH6Active: boolean;
  isBulletListActive: boolean;
  isOrderedListActive: boolean;
  isTaskListActive: boolean;
  isInTableActive: boolean;
};

const INACTIVE_STATES: EditorActiveStates = {
  isBoldActive: false,
  isItalicActive: false,
  isStrikeActive: false,
  isCodeActive: false,
  isLinkActive: false,
  isBlockquoteActive: false,
  isH1Active: false,
  isH2Active: false,
  isH3Active: false,
  isH4Active: false,
  isH5Active: false,
  isH6Active: false,
  isBulletListActive: false,
  isOrderedListActive: false,
  isTaskListActive: false,
  isInTableActive: false,
};

export function hasMark(state: EditorState, markType?: MarkType): boolean {
  if (!markType) return false;
  const { selection, storedMarks, doc } = state;
  if (selection.empty) return !!markType.isInSet(storedMarks ?? selection.$head.marks());
  return doc.rangeHasMark(selection.from, selection.to, markType);
}

export function hasBlockType(
  state: EditorState,
  nodeType?: NodeType,
  attrs?: Record<string, unknown>,
): boolean {
  if (!nodeType) return false;
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type !== nodeType) continue;
    if (!attrs) return true;
    return Object.entries(attrs).every(([key, value]) => String(node.attrs[key]) === String(value));
  }
  return false;
}

function deriveActiveStates(state: EditorState): EditorActiveStates {
  const marks = state.schema.marks;
  const nodes = state.schema.nodes;
  const closestListDisplayType = getClosestListType(state);
  return {
    isBoldActive: hasMark(state, marks.strong),
    isItalicActive: hasMark(state, marks.emphasis),
    isStrikeActive: hasMark(state, marks.strike_through),
    isCodeActive: hasMark(state, marks.inlineCode) || hasBlockType(state, nodes.code_block),
    isLinkActive: hasMark(state, marks.link),
    isBlockquoteActive: isBlockquoteActive(state, nodes.blockquote),
    isH1Active: hasBlockType(state, nodes.heading, { level: 1 }),
    isH2Active: hasBlockType(state, nodes.heading, { level: 2 }),
    isH3Active: hasBlockType(state, nodes.heading, { level: 3 }),
    isH4Active: hasBlockType(state, nodes.heading, { level: 4 }),
    isH5Active: hasBlockType(state, nodes.heading, { level: 5 }),
    isH6Active: hasBlockType(state, nodes.heading, { level: 6 }),
    isBulletListActive: closestListDisplayType === 'bullet',
    isOrderedListActive: closestListDisplayType === 'ordered',
    isTaskListActive: closestListDisplayType === 'task',
    isInTableActive: isInTable(state),
  };
}

export function useEditorActiveStates(editorRef: RefObject<Editor | null>): {
  activeStates: EditorActiveStates;
  updateActiveStates: () => void;
} {
  const [activeStates, setActiveStates] = useState(INACTIVE_STATES);
  const updateActiveStates = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    try {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        if (view) setActiveStates(deriveActiveStates(view.state));
      });
    } catch {
      // The editor may have been destroyed between the ref read and action.
    }
  }, [editorRef]);
  return { activeStates, updateActiveStates };
}
