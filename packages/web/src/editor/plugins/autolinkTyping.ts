import type { Ctx } from '@milkdown/kit/ctx';
import { Plugin } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { findHttpUrls, type HttpUrlMatch } from '../../utils/url';
import { isEligibleAutolinkRange } from '../utils/textRunUrls';

// Newlines are left to the editor's normal block/list keymaps; matching one
// here would consume Enter as inline text instead of splitting the block.
const URL_DELIMITER_PATTERN = /(\S+)([ \t])$/u;

interface EligibleTrailingUrl {
  from: number;
  to: number;
  href: string;
}

function getTrailingHttpUrl(value: string): HttpUrlMatch | undefined {
  const match = findHttpUrls(value).at(-1);
  if (!match) return undefined;
  return /^[,.;:!?)]*$/u.test(value.slice(match.to)) ? match : undefined;
}

function getTrailingToken(
  parent: EditorView['state']['doc'],
  parentOffset: number,
): string | undefined {
  let offset = parentOffset;
  let token = '';
  let hasNonWhitespace = false;

  while (offset > 0) {
    const child = parent.childBefore(offset);
    if (!child.node?.isText) return undefined;
    const text = child.node.text?.slice(0, offset - child.offset) ?? '';
    for (let index = text.length - 1; index >= 0; index -= 1) {
      if (/\s/u.test(text.charAt(index))) {
        if (hasNonWhitespace) return text.slice(index + 1) + token;
      } else {
        hasNonWhitespace = true;
      }
    }
    token = text + token;
    offset = child.offset;
  }

  return token;
}

function findEligibleTrailingUrl(
  view: EditorView,
  cursor: number,
  textBeforeCursor: string,
  delimiterLength: number,
): EligibleTrailingUrl | undefined {
  const { state } = view;
  const linkMarkType = state.schema.marks.link;
  const $cursor = state.doc.resolve(cursor - delimiterLength);
  if (
    !linkMarkType ||
    $cursor.parent.type.spec.code ||
    $cursor.marks().some((mark) => mark.type.spec.code) ||
    state.storedMarks?.some((mark) => mark.type.spec.code)
  ) {
    return undefined;
  }

  const textBeforeUrl = delimiterLength
    ? textBeforeCursor.slice(0, -delimiterLength)
    : textBeforeCursor;
  const urlText = textBeforeUrl.match(/\S+$/u)?.[0];
  if (!urlText) return undefined;
  const url = getTrailingHttpUrl(urlText);
  if (!url) return undefined;

  const urlStart = cursor - delimiterLength - urlText.length;
  const from = urlStart + url.from;
  const to = urlStart + url.to;
  if (!isEligibleAutolinkRange(state.doc, from, to, linkMarkType)) return undefined;
  return { from, to, href: url.href };
}

function markEligibleTrailingUrl(
  view: EditorView,
  cursor: number,
  textBeforeCursor: string,
  delimiterLength: number,
): boolean {
  const url = findEligibleTrailingUrl(view, cursor, textBeforeCursor, delimiterLength);
  const linkMarkType = view.state.schema.marks.link;
  if (!url || !linkMarkType) return false;
  view.dispatch(view.state.tr.addMark(url.from, url.to, linkMarkType.create({ href: url.href })));
  return true;
}

/** Marks the URL before the browser's native delimiter insertion. */
export function handleAutolinkTextInput(
  view: EditorView,
  from: number,
  to: number,
  text: string,
): boolean {
  if (from !== to || !/^[ \t]$/u.test(text)) return false;

  const $from = view.state.doc.resolve(from);
  const token = getTrailingToken($from.parent, $from.parentOffset);
  if (token === undefined) return false;
  const textBefore = token + text;
  const match = URL_DELIMITER_PATTERN.exec(textBefore);
  if (!match) return false;
  const delimiter = match[2];
  if (!delimiter) return false;
  return markEligibleTrailingUrl(view, from + text.length, textBefore, delimiter.length);
}

/** Marks a completed URL after native text or composition input has reached editor state. */
export function handleAutolinkCompletedInput(view: EditorView): boolean {
  const { selection } = view.state;
  if (!selection.empty) return false;

  const textBeforeCursor = getTrailingToken(selection.$from.parent, selection.$from.parentOffset);
  if (textBeforeCursor === undefined) return false;
  const delimiter = textBeforeCursor.match(/[ \t]+$/u)?.[0];
  if (!delimiter) return false;
  return markEligibleTrailingUrl(view, selection.from, textBeforeCursor, delimiter.length);
}

/** Marks the known URL range, then lets the editor's normal Enter keymap split it. */
export function handleAutolinkEnter(view: EditorView, event: KeyboardEvent): boolean {
  if (event.key !== 'Enter' || event.shiftKey) return false;

  const { selection } = view.state;
  if (!selection.empty) return false;

  const textBeforeCursor = getTrailingToken(selection.$from.parent, selection.$from.parentOffset);
  if (textBeforeCursor === undefined) return false;
  markEligibleTrailingUrl(view, selection.from, textBeforeCursor, 0);
  return false;
}

export function createAutolinkTypingPlugin(): Plugin {
  let pendingCompletion: ReturnType<typeof setTimeout> | undefined;

  const cancelPendingCompletion = () => {
    if (pendingCompletion === undefined) return;
    clearTimeout(pendingCompletion);
    pendingCompletion = undefined;
  };

  const scheduleCompletion = (view: EditorView, expectedPosition?: number, delay = 0) => {
    cancelPendingCompletion();
    pendingCompletion = setTimeout(() => {
      pendingCompletion = undefined;
      if (
        view.isDestroyed ||
        !view.state.selection.empty ||
        (expectedPosition !== undefined && view.state.selection.from !== expectedPosition)
      ) {
        return;
      }
      handleAutolinkCompletedInput(view);
    }, delay);
  };

  const scheduleCompositionCompletion = (view: EditorView) => {
    cancelPendingCompletion();
    pendingCompletion = setTimeout(() => {
      pendingCompletion = undefined;
      if (view.isDestroyed || !view.state.selection.empty) return;
      scheduleCompletion(view, view.state.selection.from, 1);
    });
  };

  return new Plugin({
    props: {
      handleTextInput: (view, from, to, text) => {
        handleAutolinkTextInput(view, from, to, text);
        return false;
      },
      handleKeyDown: (view, event) => handleAutolinkEnter(view, event),
      handleDOMEvents: {
        beforeinput: (view, event) => {
          const inputEvent = event as InputEvent;
          if (inputEvent.inputType !== 'insertText') return false;
          const { from, to } = view.state.selection;
          if (inputEvent.data && inputEvent.data.length > 1 && /[ \t]$/u.test(inputEvent.data)) {
            scheduleCompletion(view, from + inputEvent.data.length);
            return false;
          }
          handleAutolinkTextInput(view, from, to, inputEvent.data ?? '');
          return false;
        },
        compositionend: (view) => {
          scheduleCompositionCompletion(view);
          return false;
        },
      },
    },
    view: () => ({
      destroy: cancelPendingCompletion,
    }),
  });
}

const autolinkTypingPlugin = $prose((_ctx: Ctx) => createAutolinkTypingPlugin());

export const autolinkTyping = [autolinkTypingPlugin].flat();
