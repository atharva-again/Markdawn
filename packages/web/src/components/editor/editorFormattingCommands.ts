import type { Editor } from '@milkdown/core';
import { editorViewCtx } from '@milkdown/core';
import { setBlockType, toggleMark } from 'prosemirror-commands';
import type { MarkType, NodeType } from 'prosemirror-model';
import { toggleBlockquote } from '../../editor/utils/blockquote';
import { showInfoToast } from '../../utils/toast';
import { ensureAbsoluteUrl } from '../../utils/url';
import { getClosestListType, switchListType, unwrapList, wrapBlocksInList } from './listCommands';
import { hasBlockType } from './useEditorActiveStates';

interface EditorFormattingCommandOptions {
  editor: Editor | null;
  identityLifecycle: { isActive(): boolean };
  isAnonymous: boolean;
  keepVisible(): void;
  pageId: string;
  reposition(): void;
  updateActiveStates(): void;
}

export interface EditorFormattingCommands {
  handleBlockquote(): void;
  handleBold(): void;
  handleBulletList(): void;
  handleCode(): void;
  handleH1(): void;
  handleH2(): void;
  handleH3(): void;
  handleH4(): void;
  handleH5(): void;
  handleH6(): void;
  handleImageUploadFromSlash(): void;
  handleInsertDivider(): void;
  handleInsertTag(): void;
  handleItalic(): void;
  handleLink(): void;
  handleOrderedList(): void;
  handleStrike(): void;
  handleTaskList(): void;
  runBlockCommand(nodeName: string, attrs?: Record<string, unknown>): void;
}

export function createEditorFormattingCommands({
  editor,
  identityLifecycle,
  isAnonymous,
  keepVisible,
  pageId,
  reposition,
  updateActiveStates,
}: EditorFormattingCommandOptions): EditorFormattingCommands {
  const runMarkCommand = (markName: string, attrs?: Record<string, unknown>) => {
    if (!editor) return;
    keepVisible();
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (!view) return;
      const marks = (view.state.schema as unknown as { marks: Record<string, unknown> }).marks;
      const markType = marks[markName];
      if (markType) toggleMark(markType as never, attrs)(view.state, view.dispatch);
    });
  };

  const runBlockCommand = (nodeName: string, attrs?: Record<string, unknown>) => {
    if (!editor) return;
    keepVisible();
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (!view) return;
      const { state, dispatch } = view;
      const nodes = (state.schema as unknown as { nodes: Record<string, unknown> }).nodes;
      const nodeType = nodes[nodeName];
      const paragraphType = nodes.paragraph;
      if (!nodeType || !paragraphType) return;

      let currentLevel: number | null = null;
      for (let depth = state.selection.$from.depth; depth > 0; depth -= 1) {
        const node = state.selection.$from.node(depth);
        if (node.type === nodeType && 'level' in node.attrs) {
          currentLevel = node.attrs.level;
          break;
        }
      }
      const targetLevel = attrs?.level as number | undefined;
      const command =
        Number(currentLevel) === Number(targetLevel)
          ? setBlockType(paragraphType as never)
          : setBlockType(nodeType as never, attrs);
      command(state, dispatch);
      setTimeout(reposition, 0);
    });
  };

  const runCodeCommand = () => {
    if (!editor) return;
    keepVisible();
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (!view) return;
      const { state, dispatch } = view;
      const nodes = (state.schema as unknown as { nodes: Record<string, NodeType> }).nodes;
      const marks = (state.schema as unknown as { marks: Record<string, MarkType> }).marks;
      const codeBlockType = nodes.code_block;
      const paragraphType = nodes.paragraph;
      const inlineCodeMark = marks.inlineCode;

      if (!codeBlockType || !paragraphType) {
        if (inlineCodeMark) toggleMark(inlineCodeMark as never)(state, dispatch);
        return;
      }
      if (hasBlockType(state, codeBlockType)) {
        const { $from } = state.selection;
        const blockStart = $from.before($from.depth);
        const blockEnd = $from.after($from.depth);
        const codeBlock = state.doc.nodeAt(blockStart);
        if (codeBlock?.type === codeBlockType) {
          const lines = codeBlock.textContent
            .split('\n')
            .filter((line, index, allLines) => line.length > 0 || index < allLines.length - 1);
          dispatch(
            state.tr.replaceWith(
              blockStart,
              blockEnd,
              lines.map((line) => paragraphType.create(null, state.schema.text(line))),
            ),
          );
        }
        return;
      }

      const { from, to } = state.selection;
      const selectedText = state.doc.textBetween(from, to, '\n', '\n');
      const isMultiline =
        from !== to &&
        (selectedText.includes('\n') ||
          state.selection.$from.start() !== state.selection.$to.start());
      if (isMultiline) {
        dispatch(
          state.tr.replaceSelectionWith(
            codeBlockType.create({ language: '' }, state.schema.text(selectedText)),
          ),
        );
      } else if (inlineCodeMark) {
        toggleMark(inlineCodeMark as never)(state, dispatch);
      }
    });
  };

  const updateSoon = () => setTimeout(updateActiveStates, 0);
  const handleBold = () => {
    runMarkCommand('strong');
    updateSoon();
  };
  const handleItalic = () => {
    runMarkCommand('emphasis');
    updateSoon();
  };
  const handleStrike = () => {
    runMarkCommand('strike_through');
    updateSoon();
  };
  const handleCode = () => {
    runCodeCommand();
    updateSoon();
  };
  const handleLink = () => {
    const url = prompt('Enter link URL:');
    if (!url || !editor) return;
    const safeUrl = ensureAbsoluteUrl(url);
    if (!safeUrl) {
      showInfoToast('Enter a safe HTTP, HTTPS, email, phone, or relative link');
      return;
    }
    keepVisible();
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const linkMark = view?.state.schema.marks.link;
      if (!view || !linkMark) return;
      view.dispatch(
        view.state.tr.addMark(
          view.state.selection.from,
          view.state.selection.to,
          linkMark.create({ href: safeUrl }),
        ),
      );
    });
    updateSoon();
  };
  const handleBlockquote = () => {
    if (!editor) return;
    keepVisible();
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (!view) return;
      toggleBlockquote(view.state, view.dispatch);
    });
    updateSoon();
  };

  const handleImageUpload = async (file: File) => {
    if (isAnonymous || !identityLifecycle.isActive()) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('pageId', pageId);
    try {
      const response = await fetch('/api/uploads', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      if (!identityLifecycle.isActive()) return;
      if (!response.ok) {
        const errorBody: unknown = await response.json();
        if (!identityLifecycle.isActive()) return;
        const message =
          errorBody && typeof errorBody === 'object' && 'message' in errorBody
            ? String(errorBody.message)
            : 'Upload failed';
        throw new Error(message);
      }
      const data: unknown = await response.json();
      if (!identityLifecycle.isActive()) return;
      if (!data || typeof data !== 'object' || !('url' in data) || typeof data.url !== 'string') {
        throw new Error('Upload returned an invalid image URL');
      }
      if (!editor) return;
      keepVisible();
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        if (!view) return;
        const imageNode = view.state.schema.nodes.image;
        const node = imageNode?.create({ src: data.url, alt: file.name });
        const transaction = node
          ? view.state.tr.insert(view.state.selection.from, node)
          : view.state.tr.insert(
              view.state.selection.from,
              view.state.schema.text(`![${file.name}](${data.url})`),
            );
        view.dispatch(transaction);
      });
    } catch (error) {
      if (identityLifecycle.isActive()) alert(`Upload failed: ${(error as Error).message}`);
    }
  };

  const handleImageUploadFromSlash = () => {
    if (isAnonymous || !identityLifecycle.isActive()) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (event) => {
      if (!identityLifecycle.isActive()) return;
      const file = (event.target as HTMLInputElement).files?.[0];
      if (file) void handleImageUpload(file);
    };
    input.click();
  };

  const handleInsertDivider = () => {
    if (!editor) return;
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const dividerType = view?.state.schema.nodes.hr;
      if (!view || !dividerType) return;
      view.dispatch(view.state.tr.insert(view.state.selection.$from.pos, dividerType.create()));
    });
  };

  const handleInsertTag = () => {
    if (!editor) return;
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (!view) return;
      view.dispatch(view.state.tr.insertText('#tag ', view.state.selection.$from.pos));
    });
  };

  const handleHeading = (level: number) => {
    runBlockCommand('heading', { level });
    updateSoon();
  };
  const restoreFocus = () => {
    setTimeout(() => {
      editor?.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        if (view && !view.hasFocus()) view.focus();
      });
    }, 0);
    updateSoon();
    setTimeout(reposition, 0);
  };

  const handleBulletList = () => {
    if (!editor) return;
    keepVisible();
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const bulletListType = view?.state.schema.nodes.bullet_list;
      if (!view?.dispatch || !bulletListType) return;
      const closestType = getClosestListType(view.state);
      if (closestType === 'task') switchListType(view.state, bulletListType, view.dispatch, {});
      else if (closestType === 'bullet') unwrapList(view.state, view.dispatch);
      else if (closestType === 'ordered') switchListType(view.state, bulletListType, view.dispatch);
      else wrapBlocksInList(view.state, bulletListType, view.dispatch);
    });
    restoreFocus();
  };
  const handleOrderedList = () => {
    if (!editor) return;
    keepVisible();
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const orderedListType = view?.state.schema.nodes.ordered_list;
      if (!view?.dispatch || !orderedListType) return;
      const closestType = getClosestListType(view.state);
      if (closestType === 'ordered') {
        const { from, to } = view.state.selection;
        const listItemType = view.state.schema.nodes.list_item;
        let hasNonList = false;
        if (from !== to) {
          view.state.doc.nodesBetween(from, to, (node, position) => {
            if (!node.isBlock || node.type.name === 'doc') return;
            const resolved = view.state.doc.resolve(position);
            if (
              resolved.depth <= 1 &&
              node.type !== listItemType &&
              node.type !== orderedListType
            ) {
              hasNonList = true;
            }
          });
        }
        if (hasNonList) wrapBlocksInList(view.state, orderedListType, view.dispatch);
        else unwrapList(view.state, view.dispatch);
      } else if (closestType === 'task') {
        switchListType(view.state, orderedListType, view.dispatch, {});
      } else if (closestType === 'bullet') {
        switchListType(view.state, orderedListType, view.dispatch);
      } else {
        wrapBlocksInList(view.state, orderedListType, view.dispatch);
      }
    });
    restoreFocus();
  };
  const handleTaskList = () => {
    if (!editor) return;
    keepVisible();
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const bulletListType = view?.state.schema.nodes.bullet_list;
      const listItemType = view?.state.schema.nodes.list_item;
      if (!view?.dispatch || !bulletListType || !listItemType) return;
      const closestType = getClosestListType(view.state);
      if (closestType === 'task') unwrapList(view.state, view.dispatch);
      else if (closestType === 'bullet' || closestType === 'ordered') {
        switchListType(view.state, bulletListType, view.dispatch, { checked: false });
      } else {
        wrapBlocksInList(view.state, bulletListType, view.dispatch, { checked: false });
      }
    });
    restoreFocus();
  };

  return {
    handleBlockquote,
    handleBold,
    handleBulletList,
    handleCode,
    handleH1: () => handleHeading(1),
    handleH2: () => handleHeading(2),
    handleH3: () => handleHeading(3),
    handleH4: () => handleHeading(4),
    handleH5: () => handleHeading(5),
    handleH6: () => handleHeading(6),
    handleImageUploadFromSlash,
    handleInsertDivider,
    handleInsertTag,
    handleItalic,
    handleLink,
    handleOrderedList,
    handleStrike,
    handleTaskList,
    runBlockCommand,
  };
}
