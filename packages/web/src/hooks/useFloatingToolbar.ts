import { useCallback, useEffect, useRef, useState } from 'react';

export interface ToolbarState {
  visible: boolean;
  position: Range | null;
}

export interface FloatingToolbarApi {
  visible: boolean;
  position: Range | null;
  keepVisible: () => void;
  reposition: () => void;
}

export function useFloatingToolbar(): FloatingToolbarApi {
  const [toolbarState, setToolbarState] = useState<ToolbarState>({
    visible: false,
    position: null,
  });

  const keepVisibleRef = useRef(false);

  const keepVisible = useCallback(() => {
    keepVisibleRef.current = true;
    setToolbarState((prev) => ({ ...prev, visible: true }));
    setTimeout(() => {
      keepVisibleRef.current = false;
    }, 300);
  }, []);

  const reposition = useCallback(() => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) {
      return;
    }
    const container = document.querySelector('.milkdown-editor');
    if (!container?.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      return;
    }
    setToolbarState({
      visible: true,
      position: selection.getRangeAt(0).cloneRange(),
    });
  }, []);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const handleSelectionChange = () => {
      timeoutId = setTimeout(() => {
        if (keepVisibleRef.current) return;

        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.rangeCount) {
          setToolbarState({ visible: false, position: null });
          return;
        }

        const range = selection.getRangeAt(0);
        const container = document.querySelector('.milkdown-editor');

        if (!container?.contains(range.commonAncestorContainer)) {
          setToolbarState({ visible: false, position: null });
          return;
        }

        setToolbarState({
          visible: true,
          position: range.cloneRange(),
        });
      }, 100);
    };

    document.addEventListener('selectionchange', handleSelectionChange);

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      clearTimeout(timeoutId);
    };
  }, []);

  return { ...toolbarState, keepVisible, reposition };
}
