import { wrapIn } from '@milkdown/kit/prose/commands';
import { Fragment, NodeRange, type NodeType, type ResolvedPos } from '@milkdown/kit/prose/model';
import type { Command, EditorState } from '@milkdown/kit/prose/state';
import { liftTarget } from '@milkdown/kit/prose/transform';

/**
 * Find the nearest blockquote containing the current block range.
 *
 * Looking at the range's direct parent is not sufficient here: a quote may
 * contain a list, callout, or another block container around the selection.
 */
export function findBlockquoteAncestorDepth(
  state: EditorState,
  blockquoteType?: NodeType,
): number | null {
  if (!blockquoteType) return null;

  const range = state.selection.$from.blockRange(state.selection.$to);
  if (!range) return null;

  for (let depth = range.depth; depth > 0; depth -= 1) {
    if (range.$from.node(depth).type === blockquoteType) return depth;
  }

  return null;
}

function getWholeDocumentBlockquoteContent(
  state: EditorState,
  blockquoteType?: NodeType,
): Fragment | null {
  if (!blockquoteType) return null;
  if (state.selection.from !== 0 || state.selection.to !== state.doc.content.size) return null;
  if (state.doc.childCount === 0) return null;

  let hasNonBlockquoteContent = false;
  let content = Fragment.empty;
  state.doc.forEach((node) => {
    if (node.type !== blockquoteType) {
      hasNonBlockquoteContent = true;
      return;
    }
    content = content.append(node.content);
  });

  return hasNonBlockquoteContent ? null : content;
}

type BlockquoteUnwrapRange = {
  from: number;
  to: number;
  content: Fragment;
};

function unwrapBlockquoteRange(
  state: EditorState,
  dispatch: Parameters<Command>[1],
  range: BlockquoteUnwrapRange,
): boolean {
  if (dispatch) {
    dispatch(state.tr.replaceWith(range.from, range.to, range.content).scrollIntoView());
  }
  return true;
}

export function isWholeDocumentBlockquoteSelection(
  state: EditorState,
  blockquoteType?: NodeType,
): boolean {
  return getWholeDocumentBlockquoteContent(state, blockquoteType) !== null;
}

export function isBlockquoteActive(state: EditorState, blockquoteType?: NodeType): boolean {
  return (
    findBlockquoteAncestorDepth(state, blockquoteType) !== null ||
    isWholeDocumentBlockquoteSelection(state, blockquoteType)
  );
}

/** Return true when a selection intersects a quote outside a common quote ancestor. */
export function hasMixedBlockquoteSelection(
  state: EditorState,
  blockquoteType?: NodeType,
): boolean {
  if (!blockquoteType) return false;

  const range = state.selection.$from.blockRange(state.selection.$to);
  if (!range || (range.depth > 0 && findBlockquoteAncestorDepth(state, blockquoteType) !== null)) {
    return false;
  }
  if (getWholeDocumentBlockquoteContent(state, blockquoteType)) return false;

  const hasQuotedEndpoint =
    hasAncestor(state.selection.$from, blockquoteType) ||
    hasAncestor(state.selection.$to, blockquoteType);
  let containsBlockquote = false;
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node) => {
    if (node.type === blockquoteType) {
      containsBlockquote = true;
      return false;
    }
    return true;
  });
  return hasQuotedEndpoint || containsBlockquote;
}

function hasAncestor(position: ResolvedPos, nodeType: NodeType): boolean {
  for (let depth = position.depth; depth > 0; depth -= 1) {
    if (position.node(depth).type === nodeType) return true;
  }
  return false;
}

/** Toggle the nearest enclosing blockquote, or wrap the selection in one. */
export function toggleBlockquote(state: EditorState, dispatch?: Parameters<Command>[1]): boolean {
  const blockquoteType = state.schema.nodes.blockquote;
  if (!blockquoteType) return false;

  const wholeDocumentContent = getWholeDocumentBlockquoteContent(state, blockquoteType);
  if (wholeDocumentContent) {
    return unwrapBlockquoteRange(state, dispatch, {
      from: 0,
      to: state.doc.content.size,
      content: wholeDocumentContent,
    });
  }

  const blockquoteDepth = findBlockquoteAncestorDepth(state, blockquoteType);
  if (blockquoteDepth === null) {
    if (hasMixedBlockquoteSelection(state, blockquoteType)) return false;
    return wrapIn(blockquoteType)(state, dispatch);
  }

  const range = new NodeRange(state.selection.$from, state.selection.$to, blockquoteDepth);
  const targetDepth = blockquoteDepth - 1;
  if (liftTarget(range) !== targetDepth) return false;
  if (dispatch) {
    const transaction = state.tr;
    transaction.lift(range, targetDepth);
    dispatch(transaction.scrollIntoView());
  }
  return true;
}
