import katex from 'katex';
import remarkMath from 'remark-math';
import type { Node as UnistNode } from 'unist';
import { visit } from 'unist-util-visit';

import type { Ctx } from '@milkdown/kit/ctx';
import { findNodeInSelection, nodeRule } from '@milkdown/kit/prose';
import { textblockTypeInputRule } from '@milkdown/kit/prose/inputrules';
import type { NodeType, Node as ProseNode } from '@milkdown/kit/prose/model';
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import type { NodeViewConstructor } from '@milkdown/kit/prose/view';
import type { MarkdownNode, ParserState, SerializerState } from '@milkdown/kit/transformer';
import { $command, $inputRule, $nodeSchema, $remark, $view } from '@milkdown/kit/utils';
import { codeBlockSchema } from '@milkdown/preset-commonmark';
import { mathEditor } from '../components/MathEditor';

// biome-ignore lint/suspicious/noExplicitAny: remark-math types are not portable
export const remarkMathPlugin = $remark('remarkMath', () => remarkMath) as any;

function visitMathBlock(ast: UnistNode): void {
  visit(
    ast,
    'math' as const,
    (
      node: UnistNode & { value: string },
      index: number | undefined,
      parent: UnistNode & { children: UnistNode[] },
    ) => {
      const { value } = node;
      const newNode: UnistNode & { type: string; lang: string; value: string } = {
        type: 'code',
        lang: 'LaTeX',
        value,
      };
      if (index != null) {
        parent.children.splice(index, 1, newNode);
      }
    },
  );
}

export const remarkMathBlockPlugin = $remark('remarkMathBlock', () => () => visitMathBlock);

const mathInlineId = 'math_inline' as const;

export const mathInlineSchema = $nodeSchema(mathInlineId, () => ({
  group: 'inline',
  inline: true,
  draggable: true,
  atom: true,
  attrs: {
    value: {
      default: '',
    },
  },
  parseDOM: [
    {
      tag: `span[data-type="${mathInlineId}"]`,
      getAttrs: (dom: HTMLElement) => ({
        value: dom.dataset.value ?? '',
      }),
    },
  ],
  toDOM: (node: ProseNode) => {
    const code = node.attrs.value as string;
    const dom = document.createElement('span');
    dom.dataset.type = mathInlineId;
    dom.dataset.value = code;
    katex.render(code, dom, {
      throwOnError: false,
      displayMode: false,
    });
    return dom;
  },
  parseMarkdown: {
    match: (node: MarkdownNode) => node.type === 'inlineMath',
    runner: (state: ParserState, node: MarkdownNode, type: NodeType) => {
      state.addNode(type, { value: (node as unknown as { value: string }).value });
    },
  },
  toMarkdown: {
    match: (node: ProseNode) => node.type.name === mathInlineId,
    runner: (state: SerializerState, node: ProseNode) => {
      state.addNode('inlineMath', undefined, node.attrs.value as string);
    },
  },
}));

export const mathInlineInputRule = $inputRule((ctx: Ctx) =>
  nodeRule(/(?:\$)([^$]+)(?:\$)$/, mathInlineSchema.type(ctx), {
    getAttr: (match: RegExpMatchArray) => ({
      value: match[1] ?? '',
    }),
  }),
);

export const mathBlockInputRule = $inputRule((ctx: Ctx) =>
  textblockTypeInputRule(/^\$\$[\s\n]$/, codeBlockSchema.type(ctx), () => ({ language: 'LaTeX' })),
);

export const toggleLatexCommand = $command('ToggleLatex', (ctx: Ctx) => {
  // biome-ignore lint/suspicious/noExplicitAny: Command types are complex
  return () => (state: any, dispatch?: any) => {
    const {
      hasNode,
      pos: latexPos,
      target: latexNode,
    } = findNodeInSelection(state, mathInlineSchema.type(ctx));

    const { selection, doc, tr } = state;

    if (!hasNode) {
      const text = doc.textBetween(selection.from, selection.to);
      const newTr = tr.replaceSelectionWith(mathInlineSchema.type(ctx).create({ value: text }));
      if (dispatch) {
        dispatch(newTr.setSelection(NodeSelection.create(newTr.doc, selection.from)));
      }
      return true;
    }

    if (!latexNode || latexPos < 0) return false;

    const content = latexNode.attrs.value as string;
    let newTr = tr.delete(latexPos, latexPos + 1);
    newTr = newTr.insertText(content, latexPos);
    if (dispatch) {
      dispatch(
        newTr.setSelection(TextSelection.create(newTr.doc, latexPos, latexPos + content.length)),
      );
    }
    return true;
  };
});

// ---------------------------------------------------------------------------
// Inline Math Editor Tooltip Plugin
// ---------------------------------------------------------------------------

export const mathEditorTooltipPlugin = () => {
  return () => {};
};

// ---------------------------------------------------------------------------
// Node view with click handling
// ---------------------------------------------------------------------------

const mathInlineView: NodeViewConstructor = (node, view, getPos) => {
  const dom = document.createElement('span');
  dom.dataset.type = mathInlineId;
  dom.dataset.value = node.attrs.value as string;
  dom.style.cursor = 'pointer';
  dom.title = 'Click to edit';

  let currentNodeValue = node.attrs.value as string;

  const render = () => {
    if (currentNodeValue) {
      dom.innerHTML = '';
      katex.render(currentNodeValue, dom, {
        throwOnError: false,
        displayMode: false,
      });
    }
  };

  render();

  dom.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const pos = getPos();
    if (typeof pos !== 'number') return;

    mathEditor.open(view, dom, {
      initialValue: currentNodeValue,
      displayMode: 'inline',
      onConfirm: (newValue) => {
        const tr = view.state.tr.setNodeMarkup(pos, undefined, { value: newValue });
        view.dispatch(tr);
      },
      onCancel: () => {},
    });
  });

  return {
    dom,
    update: (updatedNode) => {
      if (updatedNode.type.name !== mathInlineId) return false;
      const newValue = updatedNode.attrs.value as string;
      if (newValue !== currentNodeValue) {
        currentNodeValue = newValue;
        dom.dataset.value = newValue;
        render();
      }
      return true;
    },
    ignoreMutation: () => true,
    destroy: () => {
      dom.innerHTML = '';
    },
  };
};

export const mathInlineViewPlugin = $view(mathInlineSchema.node, () => mathInlineView);

// ---------------------------------------------------------------------------
// Block math view
// ---------------------------------------------------------------------------

const latexCodeBlockView: NodeViewConstructor = (node, view, getPos) => {
  const language = ((node.attrs.language as string) ?? '').toLowerCase();
  const isLatex = language === 'latex';

  if (!isLatex) {
    return null as unknown as ReturnType<NodeViewConstructor>;
  }

  const dom = document.createElement('div');
  dom.className = 'latex-block-math';
  dom.style.cssText = `
    text-align: center;
    padding: 16px;
    cursor: pointer;
    border-radius: 4px;
    transition: background-color 0.2s;
  `;

  let currentNodeContent = node.content.firstChild?.text ?? '';

  dom.addEventListener('mouseenter', () => {
    dom.style.background = 'rgba(0, 0, 0, 0.05)';
  });

  dom.addEventListener('mouseleave', () => {
    dom.style.background = 'transparent';
  });

  dom.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const pos = getPos();
    if (typeof pos !== 'number') return;

    mathEditor.open(view, dom, {
      initialValue: currentNodeContent,
      displayMode: 'block',
      onConfirm: (newValue) => {
        const tr = view.state.tr;
        const attrs = { ...node.attrs, language: 'LaTeX' };
        const textNode = view.state.schema.text(newValue);
        const codeBlockType = view.state.schema.nodes.code_block;
        if (!codeBlockType) return;
        const newCodeBlock = codeBlockType.create(attrs, textNode);
        tr.replaceWith(pos, pos + node.nodeSize, newCodeBlock);
        view.dispatch(tr);
      },
      onCancel: () => {},
    });
  });

  const render = () => {
    if (currentNodeContent) {
      dom.innerHTML = '';
      try {
        const html = katex.renderToString(currentNodeContent, {
          throwOnError: false,
          displayMode: true,
        });
        dom.innerHTML = html;
      } catch {
        dom.textContent = currentNodeContent;
      }
    }
  };

  render();

  return {
    dom,
    update: (updatedNode) => {
      if (updatedNode.type.name !== 'code_block') return false;
      const newLang = ((updatedNode.attrs.language as string) ?? '').toLowerCase();
      if (newLang !== 'latex') return false;

      const newCode = updatedNode.content.firstChild?.text ?? '';
      if (newCode !== currentNodeContent) {
        currentNodeContent = newCode;
        render();
      }
      return true;
    },
    ignoreMutation: () => true,
    destroy: () => {
      dom.innerHTML = '';
    },
    selectNode: () => {
      view.focus();
      const pos = getPos();
      if (typeof pos === 'number') {
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
      }
    },
  };
};

export const latexCodeBlockViewPlugin = $view(codeBlockSchema.node, () => latexCodeBlockView);

// ---------------------------------------------------------------------------
// All math plugins as individual exports for chaining with .use()
// ---------------------------------------------------------------------------

export const mathPlugins = [
  remarkMathPlugin,
  remarkMathBlockPlugin,
  mathInlineSchema,
  mathInlineInputRule,
  mathBlockInputRule,
  toggleLatexCommand,
  mathInlineViewPlugin,
  latexCodeBlockViewPlugin,
  mathEditorTooltipPlugin,
];
