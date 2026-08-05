import type { Editor } from '@milkdown/core';
import { Schema } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { describe, expect, it, vi } from 'vitest';
import { createEditorFormattingCommands } from './editorFormattingCommands';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    text: { group: 'inline' },
    hr: { group: 'block', atom: true },
  },
  marks: {},
});

describe('editor formatting commands', () => {
  it('dispatches one complete divider transaction', () => {
    const doc = schema.topNodeType.create(null, [schema.nodes.paragraph.create()]);
    let state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, 1),
    });
    let dispatchCount = 0;
    let dispatchedTransaction: typeof state.tr | undefined;
    const view = {
      get state() {
        return state;
      },
      dispatch: (transaction: typeof state.tr) => {
        dispatchCount += 1;
        dispatchedTransaction = transaction;
        state = state.apply(transaction);
      },
    };
    const editor = {
      action: (callback: (context: { get: () => typeof view }) => void) =>
        callback({ get: () => view }),
    } as unknown as Editor;

    const commands = createEditorFormattingCommands({
      editor,
      identityLifecycle: { isActive: () => true },
      isAnonymous: false,
      keepVisible: vi.fn(),
      pageId: 'page-1',
      reposition: vi.fn(),
      updateActiveStates: vi.fn(),
    });

    commands.handleInsertDivider();

    expect(dispatchCount).toBe(1);
    expect(dispatchedTransaction?.scrolledIntoView).toBe(true);
    expect(state.doc.toJSON()).toEqual({
      type: 'doc',
      content: [{ type: 'hr' }, { type: 'paragraph' }],
    });
    expect(state.selection.$from.parent.type.name).toBe('paragraph');
  });
});
