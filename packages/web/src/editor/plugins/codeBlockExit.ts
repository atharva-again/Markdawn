import type { Command } from '@milkdown/kit/prose/state';
import { $shortcut } from '@milkdown/utils';
import { exitCode } from 'prosemirror-commands';

function isOnEmptyFinalCodeLine(state: Parameters<Command>[0]): boolean {
  const { $from, $to } = state.selection;
  if (!$from.sameParent($to) || !$from.parent.type.spec.code) return false;
  if ($from.parentOffset !== $from.parent.content.size) return false;

  const textBeforeCursor = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n');
  return textBeforeCursor.length === 0 || textBeforeCursor.endsWith('\n');
}

export const exitCodeBlockOnEmptyFinalLine: Command = (state, dispatch) => {
  if (!isOnEmptyFinalCodeLine(state)) return false;
  if (!dispatch) return exitCode(state);

  // The first Enter created the empty final line that triggers this exit.
  // Remove that line so the serialized code block has no trailing blank line.
  const shouldRemoveTrailingNewline = state.selection.$from.parentOffset > 0;
  return exitCode(state, (transaction) => {
    if (shouldRemoveTrailingNewline) {
      const cursor = state.selection.$from.pos;
      transaction.delete(cursor - 1, cursor);
    }
    dispatch(transaction);
  });
};

export const codeBlockExitShortcut = $shortcut(() => ({
  Enter: {
    key: 'Enter',
    onRun: () => exitCodeBlockOnEmptyFinalLine,
    priority: 100,
  },
}));
