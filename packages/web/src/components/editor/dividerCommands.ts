import type { EditorState, Transaction } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';

function createDividerTransactionAtOffset(
  state: EditorState,
  beforeOffset: number,
  afterOffset = beforeOffset,
): Transaction | null {
  const dividerType = state.schema.nodes.hr;
  const paragraphType = state.schema.nodes.paragraph;
  if (!dividerType || !paragraphType || !state.selection.empty) return null;

  const { $from } = state.selection;
  if (!$from.parent.isTextblock) return null;
  if (beforeOffset < 0 || beforeOffset > afterOffset || afterOffset > $from.parent.content.size) {
    return null;
  }

  const blockStart = $from.before($from.depth);
  const beforeBlock = $from.parent.cut(0, beforeOffset);
  const afterBlock = $from.parent.cut(afterOffset);
  if ($from.depth > 1 && beforeBlock.content.size === 0) return null;

  const divider = dividerType.create();
  const paragraph = paragraphType.create();
  const beforeNodes = beforeBlock.content.size > 0 ? [beforeBlock] : [];
  const afterNodes = afterBlock.content.size > 0 ? [afterBlock] : [];
  const transaction = state.tr.replaceWith($from.before($from.depth), $from.after($from.depth), [
    ...beforeNodes,
    divider,
    paragraph,
    ...afterNodes,
  ]);
  const dividerPos = blockStart + beforeNodes.reduce((size, node) => size + node.nodeSize, 0);
  const cursorPos = dividerPos + divider.nodeSize + 1;
  return transaction.setSelection(TextSelection.near(transaction.doc.resolve(cursorPos)));
}

/** Insert a divider and place the caret in the paragraph immediately below it. */
export function createDividerTransaction(state: EditorState): Transaction | null {
  return createDividerTransactionAtOffset(state, state.selection.$from.parentOffset);
}

/** Convert a top-level Markdown divider shortcut into a divider and a paragraph below it. */
export function createDividerInputTransaction(
  state: EditorState,
  from: number,
  to: number,
  text: string,
): Transaction | null {
  if (!state.selection.empty || from !== to || from !== state.selection.from) return null;

  const { $from } = state.selection;
  if ($from.parent.type.spec.code) return null;

  const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
  const input = textBefore + text;
  if (input !== '---' && input !== '___ ' && input !== '*** ') return null;

  return createDividerTransactionAtOffset(
    state,
    $from.parentOffset - textBefore.length,
    $from.parentOffset,
  );
}
