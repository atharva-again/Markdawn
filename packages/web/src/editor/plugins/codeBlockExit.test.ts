import { Schema } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { describe, expect, it, vi } from 'vitest';
import { exitCodeBlockOnEmptyFinalLine } from './codeBlockExit';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    code_block: { content: 'text*', group: 'block', code: true },
    text: { group: 'inline' },
  },
});

function stateWithCode(code: string, cursor = code.length): EditorState {
  const codeBlock = schema.node('code_block', null, code ? schema.text(code) : undefined);
  const doc = schema.node('doc', null, [codeBlock]);
  return EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, cursor + 1),
  });
}

describe('exitCodeBlockOnEmptyFinalLine', () => {
  it('exits after an empty final line and removes that line', () => {
    const state = stateWithCode('const first = 1;\nconst second = 2;\n');
    let nextState = state;

    expect(
      exitCodeBlockOnEmptyFinalLine(state, (transaction) => {
        nextState = state.apply(transaction);
      }),
    ).toBe(true);

    expect(nextState.doc.child(0).textContent).toBe('const first = 1;\nconst second = 2;');
    expect(nextState.doc.child(1).type.name).toBe('paragraph');
    expect(nextState.selection.$from.parent.type.name).toBe('paragraph');
  });

  it('does not handle Enter at the end of a non-empty code line', () => {
    const dispatch = vi.fn();

    expect(exitCodeBlockOnEmptyFinalLine(stateWithCode('const answer = 42;'), dispatch)).toBe(
      false,
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not handle Enter before the final code line', () => {
    const dispatch = vi.fn();

    expect(exitCodeBlockOnEmptyFinalLine(stateWithCode('first\nsecond\n', 5), dispatch)).toBe(
      false,
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not handle Enter outside a code block', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('text'))]);
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, 5),
    });
    const dispatch = vi.fn();

    expect(exitCodeBlockOnEmptyFinalLine(state, dispatch)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
