import type { EditorState, Transaction } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';

/** Insert a divider and place the caret in the paragraph immediately below it. */
export function createDividerTransaction(state: EditorState): Transaction | null {
  const dividerType = state.schema.nodes.hr;
  const paragraphType = state.schema.nodes.paragraph;
  if (!dividerType || !paragraphType || !state.selection.empty) return null;

  const { $from } = state.selection;
  if (!$from.parent.isTextblock) return null;

  const blockStart = $from.before($from.depth);
  const offset = $from.pos - $from.start($from.depth);
  const beforeBlock = $from.parent.cut(0, offset);
  const afterBlock = $from.parent.cut(offset);
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
