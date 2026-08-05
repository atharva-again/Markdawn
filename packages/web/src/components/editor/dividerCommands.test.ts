import { Schema } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { createDividerInputTransaction, createDividerTransaction } from './dividerCommands';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    text: { group: 'inline' },
    hr: { group: 'block', atom: true },
  },
  marks: {},
});

describe('createDividerTransaction', () => {
  it('inserts a divider and places the caret in the paragraph below it', () => {
    const doc = schema.topNodeType.create(null, [schema.nodes.paragraph.create()]);
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, 1),
    });
    const transaction = createDividerTransaction(state);

    expect(transaction).not.toBeNull();
    if (!transaction) return;
    const nextState = state.apply(transaction);

    expect(nextState.doc.toJSON()).toEqual({
      type: 'doc',
      content: [{ type: 'hr' }, { type: 'paragraph' }],
    });
    expect(nextState.selection.$from.parent.type.name).toBe('paragraph');
  });

  it('preserves text before and after the insertion point', () => {
    const paragraph = schema.nodes.paragraph.create(null, schema.text('BeforeAfter'));
    const doc = schema.topNodeType.create(null, [paragraph]);
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, 7),
    });
    const transaction = createDividerTransaction(state);

    expect(transaction).not.toBeNull();
    if (!transaction) return;
    expect(state.apply(transaction).doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
        { type: 'hr' },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
      ],
    });
  });

  it('converts a typed Markdown divider shortcut', () => {
    const paragraph = schema.nodes.paragraph.create(null, schema.text('--'));
    const doc = schema.topNodeType.create(null, [paragraph]);
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, 3),
    });
    const transaction = createDividerInputTransaction(state, 3, 3, '-');

    expect(transaction).not.toBeNull();
    if (!transaction) return;
    expect(state.apply(transaction).doc.toJSON()).toEqual({
      type: 'doc',
      content: [{ type: 'hr' }, { type: 'paragraph' }],
    });
  });
});
