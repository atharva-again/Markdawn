import type { ReferenceType } from '@floating-ui/react';
import {
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
  useTransitionStyles,
} from '@floating-ui/react';
import { useCallback, useState } from 'react';

interface UseFloatingMenuOptions {
  align?: 'start' | 'end';
  matchReferenceWidth?: boolean;
  role?: 'dialog' | 'listbox' | 'menu';
  sideOffset?: number;
  onOpen?: () => void;
}

export function useFloatingMenu({
  align = 'end',
  matchReferenceWidth = false,
  role = 'menu',
  sideOffset = 4,
  onOpen,
}: UseFloatingMenuOptions = {}) {
  const [isOpen, setIsOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    placement: `bottom-${align}`,
    middleware: [
      offset(sideOffset),
      flip(),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, availableWidth, elements, rects }) {
          Object.assign(elements.floating.style, {
            maxHeight: `${Math.max(0, availableHeight)}px`,
            maxWidth: `${Math.max(0, availableWidth)}px`,
            ...(matchReferenceWidth ? { minWidth: `${rects.reference.width}px` } : {}),
          });
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
    open: isOpen,
    onOpenChange: (open) => {
      if (open) onOpen?.();
      setIsOpen(open);
    },
  });
  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
    initial: { opacity: 0 },
  });
  const click = useClick(context);
  const dismiss = useDismiss(context);
  const roleInteraction = useRole(context, { role });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    click,
    dismiss,
    roleInteraction,
  ]);
  const close = useCallback(() => setIsOpen(false), []);
  const open = useCallback(() => setIsOpen(true), []);

  return {
    isOpen,
    isMounted,
    context,
    open,
    close,
    setIsOpen,
    refs: refs as ReturnType<typeof useFloating<ReferenceType>>['refs'],
    floatingStyles,
    transitionStyles,
    getReferenceProps,
    getFloatingProps,
  };
}
