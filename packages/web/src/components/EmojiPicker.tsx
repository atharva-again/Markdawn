import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../hooks/useTheme';

interface EmojiPickerProps {
  icon: string | null;
  onChange: (icon: string | null) => void;
  children: React.ReactNode;
}

export function EmojiPicker({ onChange, children }: EmojiPickerProps) {
  const [opened, setOpened] = useState(false);
  const { isDark } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!opened) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpened(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [opened]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpened((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpened((o) => !o);
          }
        }}
        className="cursor-pointer inline-block bg-transparent border-none p-0"
      >
        {children}
      </button>
      {opened && (
        <div className="absolute z-40 top-full left-0 mt-1 animate-scale-in origin-top-left">
          <div className="rounded-lg shadow-xl overflow-hidden border-none">
            <Picker
              data={data}
              onEmojiSelect={(emoji: { native: string }) => {
                onChange(emoji.native);
                setOpened(false);
              }}
              theme={isDark ? 'dark' : 'light'}
            />
          </div>
        </div>
      )}
    </div>
  );
}
