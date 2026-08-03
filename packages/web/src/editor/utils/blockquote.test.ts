import { type Node, Schema } from '@milkdown/kit/prose/model';
import {
  AllSelection,
  EditorState,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { describe, expect, it } from 'vitest';
import { blockquoteShortcutCommand } from '../plugins/blockquoteShortcut';
import { hasMixedBlockquoteSelection, isBlockquoteActive, toggleBlockquote } from './blockquote';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    blockquote: { content: 'block+', group: 'block' },
    bullet_list: { content: 'list_item+', group: 'block' },
    list_item: { content: 'paragraph block*' },
    text: { group: 'inline' },
  },
});

function paragraph(text: string): Node {
  return schema.nodes.paragraph.create(null, schema.text(text));
}

function blockquote(...content: Node[]): Node {
  return schema.nodes.blockquote.create(null, content);
}

function bulletList(text: string): Node {
  const item = schema.nodes.list_item.create(null, paragraph(text));
  return schema.nodes.bullet_list.create(null, item);
}

function cursorInText(doc: Node, text: string): TextSelection {
  let position: number | null = null;
  doc.descendants((node, nodePosition) => {
    if (node.isText && node.text === text) {
      position = nodePosition + 1;
      return false;
    }
    return undefined;
  });
  if (position === null) throw new Error(`Text not found: ${text}`);
  return TextSelection.create(doc, position);
}

function applyToggle(state: EditorState): EditorState {
  let transaction: Transaction | null = null;
  expect(
    toggleBlockquote(state, (nextTransaction) => {
      transaction = nextTransaction;
    }),
  ).toBe(true);
  if (!transaction) throw new Error('Expected blockquote toggle transaction');
  return state.apply(transaction);
}

describe('toggleBlockquote', () => {
  it('wraps and unwraps a block with a cursor selection', () => {
    const initialDoc = schema.nodes.doc.create(null, paragraph('quoted text'));
    const wrapped = applyToggle(
      EditorState.create({ doc: initialDoc, selection: cursorInText(initialDoc, 'quoted text') }),
    );

    expect(wrapped.doc.toString()).toBe('doc(blockquote(paragraph("quoted text")))');

    const unwrapped = applyToggle(
      EditorState.create({
        doc: wrapped.doc,
        selection: cursorInText(wrapped.doc, 'quoted text'),
      }),
    );
    expect(unwrapped.doc.toString()).toBe('doc(paragraph("quoted text"))');
  });

  it('lifts a blockquote around a list while preserving the list', () => {
    const initialDoc = schema.nodes.doc.create(null, blockquote(bulletList('list item')));
    const unwrapped = applyToggle(
      EditorState.create({ doc: initialDoc, selection: cursorInText(initialDoc, 'list item') }),
    );

    expect(unwrapped.doc.toString()).toBe('doc(bullet_list(list_item(paragraph("list item"))))');
  });

  it('lifts a blockquote containing multiple selected blocks', () => {
    const initialDoc = schema.nodes.doc.create(
      null,
      blockquote(paragraph('first'), paragraph('second')),
    );
    const initialState = EditorState.create({
      doc: initialDoc,
      selection: TextSelection.create(initialDoc, 2, 9),
    });

    const unwrapped = applyToggle(initialState);

    expect(unwrapped.doc.toString()).toBe('doc(paragraph("first"), paragraph("second"))');
  });

  it('wraps and unwraps an all-document selection', () => {
    const initialDoc = schema.nodes.doc.create(null, [paragraph('first'), paragraph('second')]);
    const wrapped = applyToggle(
      EditorState.create({ doc: initialDoc, selection: new AllSelection(initialDoc) }),
    );

    expect(wrapped.doc.toString()).toBe('doc(blockquote(paragraph("first"), paragraph("second")))');

    let transaction: Transaction | null = null;
    expect(
      blockquoteShortcutCommand(wrapped, (nextTransaction) => {
        transaction = nextTransaction;
      }),
    ).toBe(true);
    if (!transaction) throw new Error('Expected blockquote shortcut transaction');
    const unwrapped = wrapped.apply(transaction);

    expect(unwrapped.doc.toString()).toBe('doc(paragraph("first"), paragraph("second"))');
  });

  it('reports a top-level blockquote as active for an all-document selection', () => {
    const doc = schema.nodes.doc.create(null, blockquote(paragraph('quoted')));
    const state = EditorState.create({ doc, selection: new AllSelection(doc) });

    expect(isBlockquoteActive(state, schema.nodes.blockquote)).toBe(true);
  });

  it('does not nest a quote for a mixed quoted and unquoted selection', () => {
    const initialDoc = schema.nodes.doc.create(null, [
      blockquote(paragraph('quoted')),
      paragraph('plain'),
    ]);
    const from = cursorInText(initialDoc, 'quoted').from;
    const to = cursorInText(initialDoc, 'plain').to;
    const state = EditorState.create({
      doc: initialDoc,
      selection: TextSelection.create(initialDoc, from, to),
    });
    let dispatched = false;

    expect(hasMixedBlockquoteSelection(state, schema.nodes.blockquote)).toBe(true);
    expect(
      toggleBlockquote(state, () => {
        dispatched = true;
      }),
    ).toBe(false);
    expect(dispatched).toBe(false);
    expect(blockquoteShortcutCommand(state)).toBe(true);
    expect(state.doc.toString()).toBe('doc(blockquote(paragraph("quoted")), paragraph("plain"))');
  });
});
