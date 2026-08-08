import {
  defaultValueCtx,
  Editor,
  editorViewCtx,
  editorViewOptionsCtx,
  rootCtx,
} from '@milkdown/core';
import { collab, collabServiceCtx } from '@milkdown/plugin-collab';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { commonmark, syncHeadingIdPlugin } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import { insert } from '@milkdown/utils';
import Papa from 'papaparse';
import { goToNextCell, isInTable } from 'prosemirror-tables';
import { useCallback, useEffect, useRef, useState } from 'react';
import { linkEditor } from '../editor/components/LinkEditor';
import { autolink } from '../editor/plugins/autolink';
import { handleUrlPasteIntent } from '../editor/plugins/autolinkPaste';
import { blockquoteShortcut } from '../editor/plugins/blockquoteShortcut';
import { callout } from '../editor/plugins/callout';
import { codeBlockExitShortcut } from '../editor/plugins/codeBlockExit';
import {
  latexCodeBlockViewPlugin,
  mathBlockInputRule,
  mathEditorTooltipPlugin,
  mathInlineInputRule,
  mathInlineSchema,
  mathInlineViewPlugin,
  remarkMathBlockPlugin,
  remarkMathPlugin,
  toggleLatexCommand,
} from '../editor/plugins/math';
import { createSafeLinkView } from '../editor/plugins/safeLinkView';
import { tag } from '../editor/plugins/tag';
import { wikiLinkView } from '../editor/plugins/wikiLinkView';
import { wikiLink } from '../editor/plugins/wikilink';
import { repairDocument } from '../editor/utils/documentRepair';
import { routeEditorPaste } from '../editor/utils/pasteRouter';
import type { WikiLinkNavigationTarget } from '../editor/wikiLinkPresentations';
import { ensureAbsoluteUrl } from '../utils/url';
import 'katex/dist/katex.min.css';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { getContrastColor } from '@markdawn/shared';
import type * as Y from 'yjs';
import { createDividerInputTransaction } from '../components/editor/dividerCommands';
import { getLogger } from '../logger-init';
import { getInitial } from '../utils/avatar';

const EDITOR_INITIALIZATION_TIMEOUT_MS = 10_000;

type DestroyableEditor = { destroy: () => unknown | Promise<unknown> };

class EditorOperationTimeoutError extends Error {}

async function runWithTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = window.setTimeout(
          () => reject(new EditorOperationTimeoutError(timeoutMessage)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
}

export async function createEditorWithTimeout<T extends DestroyableEditor>(
  createEditor: () => Promise<T>,
  timeoutMs = EDITOR_INITIALIZATION_TIMEOUT_MS,
  disposeLateEditor: (editor: T) => unknown | Promise<unknown> = (editor) => editor.destroy(),
): Promise<T> {
  // Resolve through a promise so synchronous configuration failures and
  // asynchronous create failures share the same initialization boundary.
  const editorPromise = Promise.resolve().then(createEditor);
  try {
    return await runWithTimeout(editorPromise, timeoutMs, 'Editor initialization timed out');
  } catch (error) {
    // A timed-out editor may still finish creating. It cannot be used by this
    // attempt, so destroy it when it arrives and rethrow to the UI boundary.
    void editorPromise.then(
      (lateEditor) =>
        Promise.resolve(disposeLateEditor(lateEditor)).catch((cleanupError: unknown) => {
          getLogger()
            .error`Failed to destroy an editor from a failed initialization: ${cleanupError}`;
        }),
      () => undefined,
    );
    throw error;
  }
}

const cursorBuilder = (user: { name: string; color: string; avatar?: string; emoji?: string }) => {
  const cursor = document.createElement('span');
  cursor.classList.add('ProseMirror-yjs-cursor');
  cursor.style.borderColor = user.color;
  cursor.style.backgroundColor = user.color;

  const hitArea = document.createElement('div');
  hitArea.classList.add('ProseMirror-yjs-cursor-hitarea');
  cursor.appendChild(hitArea);

  const pill = document.createElement('div');
  pill.classList.add('ProseMirror-yjs-cursor-pill');
  pill.style.backgroundColor = user.color;
  pill.style.color = getContrastColor(user.color);

  if (user.avatar) {
    const img = document.createElement('img');
    img.src = user.avatar;
    img.alt = user.name;
    img.referrerPolicy = 'no-referrer';
    pill.appendChild(img);
  } else if (user.emoji) {
    const wrapper = document.createElement('span');
    wrapper.style.width = '20px';
    wrapper.style.height = '20px';
    wrapper.style.borderRadius = '50%';
    wrapper.style.backgroundColor = 'rgba(0, 0, 0, 0.2)';
    wrapper.style.display = 'inline-flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.justifyContent = 'center';
    wrapper.style.fontSize = '14px';
    wrapper.innerText = user.emoji;
    pill.appendChild(wrapper);
  } else {
    const initials = document.createElement('div');
    initials.classList.add('ProseMirror-yjs-cursor-initials');
    initials.innerText = getInitial(user.name);
    pill.appendChild(initials);
  }

  const name = document.createElement('span');
  name.innerText = user.name;
  pill.appendChild(name);

  cursor.appendChild(pill);
  return cursor;
};

function isLikelyMarkdown(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;

  const markdownSignals = [
    /^#{1,6}\s/m,
    /^>\s/m,
    /^[-*+]\s/m,
    /^\d+\.\s/m,
    /^-{3,}$/m,
    /^```/m,
    /\*\*[^*]+\*\*/,
    /`[^`]+`/,
    /\[[^\]]+\]\([^)]+\)/,
    /\|.+\|/,
    /~~[^~]+~~/,
    /^- \[( |x)\]\s/m,
    /\$[^$]+\$/,
    /^\$\$[\s\S]*?\$\$$/m,
  ];

  return markdownSignals.some((pattern) => pattern.test(trimmed));
}

export function isLikelyTableData(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const lines = trimmed.split('\n');
  if (lines.length < 2) return false;

  const result = Papa.parse(trimmed, {
    delimiter: '',
    preview: 5,
  });

  if (!result.data || result.data.length === 0) return false;

  const data = result.data as unknown[][];
  const colCount = data[0]?.length ?? 0;

  if (colCount < 2) return false;

  const isConsistent = data.every((row) => row.length === colCount);

  return isConsistent;
}

export function convertDelimitedToMarkdown(text: string): string {
  const trimmed = text.trim();

  const result = Papa.parse(trimmed, {
    delimiter: '',
  });

  const data = result.data as unknown[][];
  if (!data || data.length === 0) return '';

  const rows = data.map((row) => row.map((cell) => String(cell ?? '').trim()));

  const maxCols = Math.max(...rows.map((r) => r.length));
  const padded = rows.map((r) => {
    while (r.length < maxCols) {
      r.push('');
    }
    return r;
  });

  const firstRow = padded[0] ?? [];
  const header = `| ${firstRow.join(' | ')} |`;
  const separator = `| ${firstRow.map(() => '---').join(' | ')} |`;
  const body = padded.slice(1).map((r) => `| ${r.join(' | ')} |`);

  return [header, separator, ...body].join('\n');
}

interface UseMilkdownProps {
  initialValue?: string;
  onChange?: (markdown: string) => void;
  doc?: Y.Doc;
  provider?: HocuspocusProvider;
  onWikiLinkClick?: ((target: WikiLinkNavigationTarget) => void) | undefined;
  onWikiLinkSuggest?: (
    isOpen: boolean,
    query: string,
    position: { x: number; y: number; top?: number; bottom?: number } | null,
  ) => void;
  onSlashMenuSuggest?: (
    isOpen: boolean,
    query: string,
    position: { x: number; y: number; top?: number; bottom?: number } | null,
    range: { from: number; to: number } | null,
  ) => void;
  readOnly?: boolean;
}

export type MilkdownInitializationState =
  | { status: 'initializing' }
  | { status: 'ready' }
  | { status: 'error'; error: unknown };

function isTaskChecked(checked: unknown): boolean {
  return checked === true || checked === 'true';
}

function _isTaskListItem(checked: unknown): boolean {
  return checked !== null && checked !== undefined && checked !== '';
}

function findListItemAncestor(
  view: import('@milkdown/kit/prose/view').EditorView,
  pos: number,
): { node: import('@milkdown/kit/prose/model').Node; pos: number } | null {
  const $pos = view.state.doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === 'list_item') {
      return { node, pos: $pos.before(d) };
    }
  }
  return null;
}

export function useMilkdown({
  initialValue,
  onChange,
  doc,
  provider,
  onWikiLinkClick,
  onWikiLinkSuggest,
  onSlashMenuSuggest,
  readOnly = false,
}: UseMilkdownProps) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const initializationPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const teardownPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);
  const [initializationState, setInitializationState] = useState<MilkdownInitializationState>({
    status: 'initializing',
  });
  const [initializationAttempt, setInitializationAttempt] = useState(0);
  const onWikiLinkClickRef = useRef(onWikiLinkClick);
  onWikiLinkClickRef.current = onWikiLinkClick;
  const onWikiLinkSuggestRef = useRef(onWikiLinkSuggest);
  onWikiLinkSuggestRef.current = onWikiLinkSuggest;
  const onSlashMenuSuggestRef = useRef(onSlashMenuSuggest);
  onSlashMenuSuggestRef.current = onSlashMenuSuggest;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const hasCollab = Boolean(doc && provider);
  const fallbackInitialValue = hasCollab ? undefined : initialValue;
  const retryInitialization = useCallback(() => {
    setInitializationState({ status: 'initializing' });
    setInitializationAttempt((attempt) => attempt + 1);
  }, []);
  const queueEditorTeardown = useCallback((editor: Editor, disconnectCollaboration: boolean) => {
    const teardown = async () => {
      if (disconnectCollaboration) {
        try {
          editor.action((ctx) => {
            ctx.get(collabServiceCtx).disconnect();
          });
        } catch {
          // The editor or collaboration service may already be partially torn down.
        }
      }
      await runWithTimeout(
        editor.destroy(),
        EDITOR_INITIALIZATION_TIMEOUT_MS,
        'Editor teardown timed out',
      );
    };
    const settledTeardown = teardownPromiseRef.current.then(teardown).catch((error: unknown) => {
      // Teardown is a cleanup boundary: report it, then allow the next
      // initialization attempt to proceed instead of poisoning the queue.
      getLogger().error`Failed to tear down the previous editor: ${error}`;
    });
    teardownPromiseRef.current = settledTeardown;
    return settledTeardown;
  }, []);

  useEffect(() => {
    if (!container) return;
    let disposed = false;
    let runtimeEditor: Editor | null = null;
    let collabSetupTimer: number | undefined;
    setInitializationState({ status: 'initializing' });

    let floatingCopyBtn: HTMLButtonElement | null = null;
    let currentPre: HTMLElement | null = null;

    const copyIconSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
    const checkIconSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

    const getCopyButton = (): HTMLButtonElement => {
      if (!floatingCopyBtn) {
        floatingCopyBtn = document.createElement('button');
        floatingCopyBtn.className = 'code-block-copy-btn';
        floatingCopyBtn.type = 'button';
        floatingCopyBtn.innerHTML = copyIconSvg;
        floatingCopyBtn.setAttribute('aria-label', 'Copy code');
        Object.assign(floatingCopyBtn.style, {
          position: 'absolute',
          zIndex: '1000',
          opacity: '0',
          pointerEvents: 'none',
          transition: 'opacity 0.15s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '28px',
          height: '28px',
          borderRadius: '4px',
          cursor: 'pointer',
        });
        const wrapper = container?.parentElement;
        const mountTarget = wrapper ?? document.body;
        if (wrapper && getComputedStyle(wrapper).position === 'static') {
          wrapper.style.position = 'relative';
        }
        mountTarget.appendChild(floatingCopyBtn);

        floatingCopyBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!currentPre) return;
          const code = currentPre.querySelector('code');
          if (!code) return;
          navigator.clipboard.writeText(code.textContent || '').catch((err) => {
            getLogger().warn('Failed to copy code block:', err);
          });
          if (floatingCopyBtn) {
            floatingCopyBtn.innerHTML = checkIconSvg;
            setTimeout(() => {
              if (floatingCopyBtn) floatingCopyBtn.innerHTML = copyIconSvg;
            }, 1500);
          }
        });
      }
      return floatingCopyBtn;
    };

    const showCopyButton = (pre: HTMLElement): void => {
      const code = pre.querySelector('code');
      if (!code) return;

      const btn = getCopyButton();
      currentPre = pre;

      const wrapperRect = container?.parentElement?.getBoundingClientRect();
      const preRect = pre.getBoundingClientRect();
      if (wrapperRect) {
        btn.style.top = `${preRect.top - wrapperRect.top + 8}px`;
        btn.style.right = `${wrapperRect.right - preRect.right + 8}px`;
      }
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
    };

    const hideCopyButton = (): void => {
      if (floatingCopyBtn) {
        floatingCopyBtn.style.opacity = '0';
        floatingCopyBtn.style.pointerEvents = 'none';
      }
      currentPre = null;
    };

    const configure = (withCollab: boolean, attemptRoot: HTMLElement) => {
      let next = Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, attemptRoot);
          if (fallbackInitialValue) {
            ctx.set(defaultValueCtx, fallbackInitialValue);
          }

          ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
            onChange?.(markdown);
          });

          ctx.get(listenerCtx).updated((_ctx) => {
            const suggest = onWikiLinkSuggestRef.current;
            const suggestSlash = onSlashMenuSuggestRef.current;

            const view = _ctx.get(editorViewCtx);
            const { selection } = view.state;

            if (!selection.empty) {
              suggest?.(false, '', null);
              suggestSlash?.(false, '', null, null);
              return;
            }

            const { $from } = selection;
            const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');

            const match = textBefore.match(/\[\[([^\]]*)$/);
            if (match) {
              const query = match[1] || '';
              const coords = view.coordsAtPos($from.pos);
              suggest?.(true, query, {
                x: coords.left,
                y: coords.bottom + 5,
                top: coords.top,
                bottom: coords.bottom,
              });
              suggestSlash?.(false, '', null, null);
            } else {
              suggest?.(false, '', null);

              if (!suggestSlash) {
                return;
              }

              const slashIndex = textBefore.lastIndexOf('/');
              if (slashIndex < 0) {
                suggestSlash(false, '', null, null);
                return;
              }

              const prefixChar = slashIndex === 0 ? '' : (textBefore[slashIndex - 1] ?? '');
              if (prefixChar && !/\s/.test(prefixChar)) {
                suggestSlash(false, '', null, null);
                return;
              }

              const query = textBefore.slice(slashIndex + 1);

              if (query && /\s/.test(query)) {
                suggestSlash(false, '', null, null);
                return;
              }

              const coords = view.coordsAtPos($from.pos);
              const slashFrom = $from.start() + slashIndex;
              suggestSlash(
                true,
                query,
                {
                  x: coords.left,
                  y: coords.bottom + 5,
                  top: coords.top,
                  bottom: coords.bottom,
                },
                { from: slashFrom, to: $from.pos },
              );
            }
          });

          if (withCollab) {
            ctx.get(collabServiceCtx).setOptions({
              yCursorOpts: {
                cursorBuilder,
              },
            });
          }

          ctx.update(editorViewOptionsCtx, (prev) => ({
            ...prev,
            editable: () => !readOnlyRef.current,
            attributes: {
              class: 'milkdown-editor-view',
              spellcheck: 'false',
            },
            markViews: {
              ...prev.markViews,
              link: createSafeLinkView,
            },
            handleTextInput: (view, from, to, text) => {
              const transaction = createDividerInputTransaction(view.state, from, to, text);
              if (!transaction) return false;
              view.dispatch(transaction.scrollIntoView());
              return true;
            },
            handlePaste: (view, event) => {
              if (readOnlyRef.current) return false;
              return routeEditorPaste(event.clipboardData, {
                handleUrl: (intent) => handleUrlPasteIntent(view, intent),
                handleTable: (text) => {
                  editorRef.current?.action(insert(convertDelimitedToMarkdown(text)));
                },
                handleMarkdown: (text) => {
                  editorRef.current?.action(insert(text));
                },
                isLikelyMarkdown,
                isLikelyTableData,
              });
            },
            handleDOMEvents: {
              keydown: (view, event) => {
                if (readOnlyRef.current) return false;
                const { state, dispatch } = view;

                if (!isInTable(state)) return false;

                if (event.key === 'Tab') {
                  event.preventDefault();
                  const direction = event.shiftKey ? -1 : 1;
                  goToNextCell(direction)(state, dispatch);
                  return true;
                }
                return false;
              },
              mousedown: (view, event) => {
                const target = event.target;
                if (!(target instanceof HTMLElement)) return false;

                const taskItem = target.closest('li[data-item-type="task"]');
                if (taskItem instanceof HTMLElement) {
                  if (readOnlyRef.current) return false;
                  const rect = taskItem.getBoundingClientRect();
                  const clickX = event.clientX - rect.left;
                  const clickY = event.clientY - rect.top;
                  const isCheckboxClick = clickX <= 28 && clickY <= 28;
                  if (!isCheckboxClick) return false;

                  event.preventDefault();
                  event.stopPropagation();

                  const result = findListItemAncestor(view, view.posAtDOM(taskItem, 0));
                  if (result) {
                    const { node, pos } = result;
                    const checked = node.attrs.checked;
                    const nextChecked = !isTaskChecked(checked);
                    const tr = view.state.tr.setNodeMarkup(pos, undefined, {
                      ...node.attrs,
                      checked: nextChecked,
                    });
                    view.dispatch(tr);
                  }
                  return true;
                }

                const anchor = target.closest('a[href]');
                if (anchor instanceof HTMLAnchorElement && anchor.classList.contains('wiki-link')) {
                  event.preventDefault();
                  event.stopPropagation();

                  linkEditor.close();

                  if (anchor.dataset.state !== 'accessible') return true;
                  const targetId = anchor.dataset.targetId;
                  const targetTitle = anchor.dataset.targetTitle;
                  if (targetId && targetTitle && onWikiLinkClickRef.current) {
                    const heading = anchor.dataset.heading;
                    onWikiLinkClickRef.current({
                      id: targetId,
                      title: targetTitle,
                      ...(heading && { heading }),
                    });
                  }
                  return true;
                }

                return false;
              },
              click: (_view, event) => {
                const target = event.target;
                if (!(target instanceof HTMLElement)) return false;

                const anchor = target.closest('a[href]');
                if (!(anchor instanceof HTMLAnchorElement)) return false;

                if (anchor.classList.contains('wiki-link')) {
                  event.preventDefault();
                  // Mouse activation is handled on mousedown so the editor
                  // selection cannot swallow it. Keyboard activation emits a
                  // click with detail=0 and must follow the same safe target.
                  if (event.detail === 0 && anchor.dataset.state === 'accessible') {
                    const targetId = anchor.dataset.targetId;
                    const targetTitle = anchor.dataset.targetTitle;
                    if (targetId && targetTitle && onWikiLinkClickRef.current) {
                      const heading = anchor.dataset.heading;
                      onWikiLinkClickRef.current({
                        id: targetId,
                        title: targetTitle,
                        ...(heading && { heading }),
                      });
                    }
                  }
                  return true;
                }

                const href = anchor.getAttribute('href') || '';
                if (!href || href === '#') return false;

                if (href.startsWith('#')) {
                  event.preventDefault();
                  const headingId = href.slice(1);
                  const element = document.getElementById(headingId);
                  if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }
                  return true;
                }

                event.preventDefault();
                linkEditor.close();
                const safeUrl = ensureAbsoluteUrl(href);
                if (!safeUrl) {
                  getLogger().warn('Blocked unsafe editor link', { href });
                  return true;
                }
                window.open(safeUrl, '_blank', 'noopener,noreferrer');
                return true;
              },
              mouseover: (view, event) => {
                const target = event.target;
                if (!(target instanceof HTMLElement)) return false;

                const pre = target.closest('pre');
                if (pre instanceof HTMLElement) {
                  if (currentPre !== pre) {
                    showCopyButton(pre);
                  }
                } else if (currentPre && !currentPre.contains(target)) {
                  hideCopyButton();
                }

                const anchor = target.closest('a[href]');
                if (!(anchor instanceof HTMLAnchorElement)) return false;

                if (anchor.classList.contains('wiki-link')) {
                  // Wiki links resolve automatically — no link editor needed.
                  return true;
                }

                const href = anchor.getAttribute('href') || '';
                if (!href || href === '#') return false;

                const markFrom = view.posAtDOM(anchor, 0);
                const markTo = view.posAtDOM(anchor, anchor.childNodes.length);
                if (markFrom >= markTo) return false;

                const linkMarkType = view.state.schema.marks.link;
                if (!linkMarkType) return false;

                const hasLink = view.state.doc.rangeHasMark(markFrom, markTo, linkMarkType);
                if (!hasLink) return false;

                if (!view.editable) return true;

                linkEditor.open(view, anchor, {
                  initialUrl: href,
                  initialText: anchor.textContent || href,
                  onConfirm: ({ url, text }) => {
                    const safeUrl = ensureAbsoluteUrl(url);
                    if (!safeUrl) {
                      getLogger().warn('Refused to persist unsafe editor link', { url });
                      return;
                    }
                    const tr = view.state.tr;
                    tr.removeMark(markFrom, markTo, linkMarkType);
                    tr.replaceWith(
                      markFrom,
                      markTo,
                      view.state.schema.text(text, [linkMarkType.create({ href: safeUrl })]),
                    );
                    view.dispatch(tr);
                  },
                  onRemove: () => {
                    const tr = view.state.tr.removeMark(markFrom, markTo, linkMarkType);
                    view.dispatch(tr);
                  },
                });
                return true;
              },
              mouseout: (_view, event) => {
                const target = event.target;
                if (!(target instanceof HTMLElement)) return false;
                if (currentPre && !currentPre.contains(target)) {
                  hideCopyButton();
                }
                return false;
              },
            },
          }));
        })
        .use(blockquoteShortcut)
        .use(commonmark)
        .use(gfm)
        .use(codeBlockExitShortcut)
        .use(wikiLink)
        .use(wikiLinkView)
        .use(callout)
        .use(tag)
        .use(autolink)
        .use(remarkMathPlugin)
        .use(remarkMathBlockPlugin)
        .use(mathInlineSchema)
        .use(mathInlineInputRule)
        .use(mathBlockInputRule)
        .use(toggleLatexCommand)
        .use(mathInlineViewPlugin)
        .use(latexCodeBlockViewPlugin)
        .use(mathEditorTooltipPlugin)
        .use(listener);

      if (withCollab) {
        next = next.use(collab);
      }

      return next;
    };

    const init = async () => {
      const shouldUseCollab = hasCollab;
      getLogger()
        .debug`Init attempt=${initializationAttempt}: shouldUseCollab=${shouldUseCollab}, doc=${!!doc}, provider=${!!provider}`;
      await teardownPromiseRef.current;
      if (disposed) return;
      let configuredEditor: Editor | null = null;
      try {
        // Each attempt owns a detached-capable root. If an old Milkdown
        // operation outlives its teardown deadline, it cannot mutate the DOM
        // of the next attempt.
        const attemptRoot = document.createElement('div');
        container.replaceChildren(attemptRoot);
        configuredEditor = configure(shouldUseCollab, attemptRoot);
        const editorToCreate = configuredEditor;
        runtimeEditor = await createEditorWithTimeout(
          () => editorToCreate.create(),
          EDITOR_INITIALIZATION_TIMEOUT_MS,
          (lateEditor) => queueEditorTeardown(lateEditor, shouldUseCollab),
        );
      } catch (error) {
        // Configuration, creation, and timeout failures are safe to translate
        // here because this hook owns the editor initialization lifecycle.
        if (configuredEditor && !(error instanceof EditorOperationTimeoutError)) {
          void queueEditorTeardown(configuredEditor, shouldUseCollab);
        }
        if (!disposed) {
          setEditorInstance(null);
          setInitializationState({ status: 'error', error });
        }
        return;
      }

      if (disposed || !runtimeEditor) {
        if (runtimeEditor) void queueEditorTeardown(runtimeEditor, shouldUseCollab);
        runtimeEditor = null;
        return;
      }

      const failInitialization = (error: unknown, waitFor?: Promise<unknown>) => {
        if (disposed) return;
        const failedEditor = runtimeEditor;
        runtimeEditor = null;
        editorRef.current = null;
        setEditorInstance(null);
        setInitializationState({ status: 'error', error });
        if (failedEditor) {
          const cleanup = waitFor
            ? waitFor
                .catch(() => undefined)
                .then(() => queueEditorTeardown(failedEditor, shouldUseCollab))
            : queueEditorTeardown(failedEditor, shouldUseCollab);
          void cleanup;
        }
      };
      const finishInitialization = () => {
        if (disposed || !runtimeEditor) return;
        try {
          runtimeEditor.action((ctx) => {
            const view = ctx.get(editorViewCtx) as
              | import('@milkdown/kit/prose/view').EditorView
              | undefined;
            if (!view) throw new Error('Editor view is unavailable after initialization');
          });
        } catch (error) {
          failInitialization(error);
          return;
        }
        editorRef.current = runtimeEditor;
        setEditorInstance(runtimeEditor);
        setInitializationState({ status: 'ready' });
      };

      if (shouldUseCollab && doc) {
        // syncHeadingIdPlugin dispatches setNodeMarkup transactions on every
        // doc update to assign heading IDs. y-prosemirror's ySyncPlugin then
        // syncs those mutations to the Y.Doc, which triggers observeDeep,
        // which re-renders ProseMirror, which fires syncHeadingIdPlugin again.
        // Milkdown's own vanilla-collab example removes this plugin in collab
        // mode. We also defer connect via setTimeout(0) so Milkdown processes
        // the plugin removal before ySyncPlugin is injected.
        const collabEditor = runtimeEditor;
        const removePromise = collabEditor.remove(syncHeadingIdPlugin);
        try {
          await runWithTimeout(
            removePromise,
            EDITOR_INITIALIZATION_TIMEOUT_MS,
            'Editor collaboration setup timed out',
          );
        } catch (error) {
          failInitialization(
            error,
            error instanceof EditorOperationTimeoutError ? removePromise : undefined,
          );
          return;
        }
        if (disposed || runtimeEditor !== collabEditor) return;
        collabSetupTimer = window.setTimeout(() => {
          if (disposed || !runtimeEditor) return;
          try {
            runtimeEditor.action((ctx) => {
              const collabService = ctx.get(collabServiceCtx);
              collabService.bindDoc(doc);
              if (provider) {
                const awareness = provider.awareness;
                if (awareness) {
                  collabService.setAwareness(awareness);
                }
                collabService.connect();
              }
            });
          } catch (error) {
            failInitialization(error);
            return;
          }
          finishInitialization();
        }, 0);
        return;
      }

      finishInitialization();
    };

    const scheduledInitialization = initializationPromiseRef.current.then(init).catch((error) => {
      // This is the final initialization boundary for unexpected controller
      // failures that escaped a phase-specific translation above.
      const failedEditor = runtimeEditor;
      runtimeEditor = null;
      editorRef.current = null;
      if (!disposed) {
        setEditorInstance(null);
        setInitializationState({ status: 'error', error });
      }
      if (failedEditor) void queueEditorTeardown(failedEditor, hasCollab);
    });
    initializationPromiseRef.current = scheduledInitialization;

    return () => {
      disposed = true;
      if (collabSetupTimer !== undefined) window.clearTimeout(collabSetupTimer);
      const retiringEditor = runtimeEditor;
      runtimeEditor = null;
      editorRef.current = null;
      setEditorInstance(null);
      if (retiringEditor) {
        void scheduledInitialization.then(() => queueEditorTeardown(retiringEditor, hasCollab));
      }
      if (floatingCopyBtn) {
        floatingCopyBtn.remove();
        floatingCopyBtn = null;
      }
    };
  }, [
    container,
    fallbackInitialValue,
    hasCollab,
    onChange,
    doc,
    provider,
    initializationAttempt,
    queueEditorTeardown,
  ]);

  useEffect(() => {
    if (!editorInstance) return;
    const isReadOnly = readOnly;
    let repairTimer: number | undefined;

    const failPermissionUpdate = (error: unknown) => {
      // The initialization effect clears this ref before retiring an editor.
      // Only that verified teardown race is safe to ignore.
      if (editorRef.current !== editorInstance) return;
      editorRef.current = null;
      setEditorInstance((current) => (current === editorInstance ? null : current));
      setInitializationState({ status: 'error', error });
    };

    try {
      editorInstance.action((ctx) => {
        const view = ctx.get(editorViewCtx) as
          | import('@milkdown/kit/prose/view').EditorView
          | undefined;
        if (!view) throw new Error('Editor view is unavailable during a permission update');
        view.setProps({ editable: () => !isReadOnly });
        if (!isReadOnly) {
          repairTimer = window.setTimeout(() => {
            if (editorRef.current !== editorInstance || readOnlyRef.current) return;
            try {
              repairDocument(view);
            } catch (error) {
              failPermissionUpdate(error);
            }
          }, 500);
        }
      });
    } catch (error) {
      failPermissionUpdate(error);
    }

    return () => {
      if (repairTimer !== undefined) window.clearTimeout(repairTimer);
    };
  }, [editorInstance, readOnly]);

  return {
    setContainer,
    editor: editorInstance,
    initializationState,
    retryInitialization,
  };
}
