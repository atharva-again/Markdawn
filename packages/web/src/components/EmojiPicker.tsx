import { FloatingFocusManager, FloatingPortal } from '@floating-ui/react';
import {
  type EmojiPickerListCategoryHeaderProps,
  type EmojiPickerListEmojiProps,
  type EmojiPickerListRowProps,
  EmojiPicker as EmojiPickerPrimitive,
} from 'frimousse';
import { Search } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useId, useState } from 'react';
import { useFloatingMenu } from '../hooks/useFloatingMenu';

const MAX_EMOJI_COLUMNS = 9;
const DEFAULT_ROOT_FONT_SIZE = 16;
const DEFAULT_EMOJI_CELL_SIZE_REM = 2;
const DEFAULT_ROW_PADDING_REM = 0.5;
const EMOJI_PICKER_INITIALIZATION_TIMEOUT_MS = 5000;

function useEmojiPickerColumns(root: HTMLDivElement | null) {
  const [columns, setColumns] = useState(MAX_EMOJI_COLUMNS);

  useEffect(() => {
    if (!root) return;

    const updateColumns = () => {
      const styles = getComputedStyle(root);
      const documentRootFontSize =
        Number.parseFloat(getComputedStyle(document.documentElement).fontSize) ||
        DEFAULT_ROOT_FONT_SIZE;
      const cellSizeRem =
        Number.parseFloat(styles.getPropertyValue('--emoji-picker-cell-size-rem')) ||
        DEFAULT_EMOJI_CELL_SIZE_REM;
      const rowPaddingRem =
        Number.parseFloat(styles.getPropertyValue('--emoji-picker-row-padding-rem')) ||
        DEFAULT_ROW_PADDING_REM;
      const cellSize = cellSizeRem * documentRootFontSize;
      const rowHorizontalPadding = rowPaddingRem * documentRootFontSize * 2;
      const availableWidth = root.clientWidth - rowHorizontalPadding;
      const nextColumns = Math.floor(availableWidth / cellSize);
      setColumns(Math.max(1, Math.min(MAX_EMOJI_COLUMNS, nextColumns)));
    };

    updateColumns();
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(updateColumns);
    observer.observe(root);
    return () => observer.disconnect();
  }, [root]);

  return columns;
}

interface EmojiPickerProps {
  icon: string | null;
  onChange: (icon: string | null) => void;
  children: React.ReactNode;
}

function EmojiPickerRow({ children, className, ...props }: EmojiPickerListRowProps) {
  return (
    <div {...props} className={`emoji-picker-row flex scroll-my-1 ${className ?? ''}`}>
      {children}
    </div>
  );
}

function EmojiPickerEmoji({ emoji, className, ...props }: EmojiPickerListEmojiProps) {
  return (
    <button
      type="button"
      {...props}
      className={`emoji-picker-emoji relative flex aspect-square max-w-[calc(100%/var(--frimousse-list-columns))] flex-1 items-center justify-center rounded-md text-lg transition-colors hover:bg-zinc-100 data-[active]:bg-zinc-100 dark:hover:bg-zinc-800 dark:data-[active]:bg-zinc-800 ${className ?? ''}`}
    >
      {emoji.emoji}
    </button>
  );
}

function EmojiPickerCategoryHeader({
  category,
  className,
  ...props
}: EmojiPickerListCategoryHeaderProps) {
  return (
    <div
      {...props}
      className={`bg-white px-3 pt-3 pb-1.5 font-medium text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400 ${className ?? ''}`}
    >
      {category.label}
    </div>
  );
}

function EmojiPickerLoading({
  hasTimedOut,
  onRetry,
  onTimeout,
}: {
  hasTimedOut: boolean;
  onRetry: () => void;
  onTimeout: () => void;
}) {
  useEffect(() => {
    const timeout = window.setTimeout(onTimeout, EMOJI_PICKER_INITIALIZATION_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [onTimeout]);

  if (!hasTimedOut) return <>Loading…</>;

  return (
    <>
      <span>Unable to initialize emoji picker.</span>
      <button type="button" className="ml-2 underline underline-offset-2" onClick={onRetry}>
        Retry
      </button>
    </>
  );
}

export function EmojiPicker({ icon, onChange, children }: EmojiPickerProps) {
  const [pickerRoot, setPickerRoot] = useState<HTMLDivElement | null>(null);
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const [loadingAttempt, setLoadingAttempt] = useState(0);
  const pickerId = useId();
  const columns = useEmojiPickerColumns(pickerRoot);
  const handlePickerOpen = useCallback(() => {
    setLoadingTimedOut(false);
  }, []);
  const handleLoadingTimeout = useCallback(() => {
    setLoadingTimedOut(true);
  }, []);
  const handleRetry = useCallback(() => {
    setLoadingTimedOut(false);
    setLoadingAttempt((attempt) => attempt + 1);
  }, []);
  const picker = useFloatingMenu({
    align: 'start',
    onOpen: handlePickerOpen,
    role: 'dialog',
    sideOffset: 4,
  });

  return (
    <>
      <button
        ref={picker.refs.setReference}
        aria-label={icon ? 'Change page icon' : 'Add page icon'}
        aria-haspopup="dialog"
        aria-expanded={picker.isOpen}
        aria-controls={picker.isOpen ? pickerId : undefined}
        type="button"
        className="cursor-pointer inline-block border-none bg-transparent p-0"
        {...picker.getReferenceProps()}
      >
        {children}
      </button>
      {picker.isMounted && (
        <FloatingPortal>
          <div
            id={pickerId}
            ref={picker.refs.setFloating}
            style={picker.floatingStyles}
            {...picker.getFloatingProps({ 'aria-label': 'Emoji picker' })}
            className="z-[9999]"
          >
            <FloatingFocusManager context={picker.context} modal={false} returnFocus>
              <div
                style={picker.transitionStyles}
                className="h-[400px] max-h-[calc(100vh-1rem)] w-[320px] max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl animate-scale-in dark:border-zinc-700 dark:bg-zinc-900"
              >
                <EmojiPickerPrimitive.Root
                  key={loadingAttempt}
                  className="emoji-picker-root isolate flex h-full min-h-0 w-full flex-col bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
                  columns={columns}
                  emojibaseUrl="/emojibase-data"
                  ref={setPickerRoot}
                  onEmojiSelect={({ emoji }) => {
                    onChange(emoji);
                    picker.close();
                  }}
                >
                  {/* Skin-tone and frequently-used controls are intentionally omitted for page icons. */}
                  <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 p-2 dark:border-zinc-700">
                    <div className="group relative min-w-0 flex-1">
                      <Search
                        aria-hidden="true"
                        className="pointer-events-none absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2 text-zinc-400 transition-colors group-focus-within:text-zinc-600 dark:text-zinc-500 dark:group-focus-within:text-zinc-300"
                      />
                      <EmojiPickerPrimitive.Search
                        aria-label="Search emoji"
                        autoFocus
                        className="h-9 w-full rounded-md bg-zinc-100 py-1.5 pr-2.5 pl-8 text-sm outline-none placeholder:text-zinc-400 focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0 dark:bg-zinc-800 dark:placeholder:text-zinc-500"
                        placeholder="Search"
                      />
                    </div>
                  </div>
                  <EmojiPickerPrimitive.Viewport className="min-h-0 flex-1 overflow-x-hidden overscroll-contain outline-none">
                    <EmojiPickerPrimitive.Loading className="flex h-full items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
                      <EmojiPickerLoading
                        hasTimedOut={loadingTimedOut}
                        onRetry={handleRetry}
                        onTimeout={handleLoadingTimeout}
                      />
                    </EmojiPickerPrimitive.Loading>
                    <EmojiPickerPrimitive.Empty className="flex h-full items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
                      No emoji found.
                    </EmojiPickerPrimitive.Empty>
                    <EmojiPickerPrimitive.List
                      className="select-none pb-2"
                      components={{
                        CategoryHeader: EmojiPickerCategoryHeader,
                        Emoji: EmojiPickerEmoji,
                        Row: EmojiPickerRow,
                      }}
                    />
                  </EmojiPickerPrimitive.Viewport>
                  <EmojiPickerPrimitive.ActiveEmoji>
                    {({ emoji }) => (
                      <div className="flex h-12 shrink-0 items-center gap-2 border-t border-zinc-200 px-3 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                        {emoji ? (
                          <>
                            <span className="text-2xl">{emoji.emoji}</span>
                            <span className="truncate">{emoji.label}</span>
                          </>
                        ) : (
                          <span>Select an emoji…</span>
                        )}
                      </div>
                    )}
                  </EmojiPickerPrimitive.ActiveEmoji>
                </EmojiPickerPrimitive.Root>
              </div>
            </FloatingFocusManager>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
