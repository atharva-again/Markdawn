import type { Command } from '@milkdown/kit/prose/state';
import { $shortcut } from '@milkdown/utils';
import { formatProseMirrorShortcut, SHORTCUT_PATTERNS } from '../../utils/keyboardShortcuts';
import { hasMixedBlockquoteSelection, toggleBlockquote } from '../utils/blockquote';

const blockquoteShortcutKey = formatProseMirrorShortcut(SHORTCUT_PATTERNS.blockquote);

/** Consume unsupported mixed selections so CommonMark cannot nest a quote. */
export const blockquoteShortcutCommand: Command = (state, dispatch) => {
  if (hasMixedBlockquoteSelection(state, state.schema.nodes.blockquote)) return true;
  return toggleBlockquote(state, dispatch);
};

/** Run the app's blockquote toggle before CommonMark's wrap-only keymap. */
export const blockquoteShortcut = $shortcut(() => ({
  [blockquoteShortcutKey]: {
    key: blockquoteShortcutKey,
    onRun: () => blockquoteShortcutCommand,
    priority: 1000,
  },
}));
