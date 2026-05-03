import { FileText } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';

type WikiLinkPage = {
  id: string;
  title: string;
  icon: string | null;
};

interface WikiLinkSuggestionsProps {
  isOpen: boolean;
  query: string;
  pages: WikiLinkPage[];
  position: { x: number; y: number } | null;
  onSelect: (page: WikiLinkPage) => void;
  onClose: () => void;
}

const MAX_RESULTS = 6;

export function WikiLinkSuggestions({
  isOpen,
  query,
  pages,
  position,
  onSelect,
  onClose,
}: WikiLinkSuggestionsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const trimmedQuery = query.trim().toLowerCase();

  const results = useMemo(() => {
    const normalized = trimmedQuery;
    const filtered = normalized
      ? pages.filter((page) => (page.title ?? '').toLowerCase().includes(normalized))
      : pages;
    return filtered.slice(0, MAX_RESULTS);
  }, [pages, trimmedQuery]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: must reset selection when query changes or menu opens/closes
  useEffect(() => {
    setSelectedIndex(0);
  }, [trimmedQuery, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((prev) => (results.length === 0 ? 0 : (prev + 1) % results.length));
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((prev) =>
          results.length === 0 ? 0 : (prev - 1 + results.length) % results.length,
        );
      }
      if (event.key === 'Enter') {
        if (!results.length) return;
        event.preventDefault();
        const selected = results[selectedIndex];
        if (selected) {
          onSelect(selected);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, onSelect, results, selectedIndex]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(event.target as Node)) return;
      onClose();
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen || !position) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="fixed z-50 w-80 max-w-[calc(100vw-2rem)] rounded-lg bg-zinc-800 shadow-xl ring-1 ring-black/10"
      style={{ left: position.x, top: position.y }}
    >
      <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        Pages
      </div>
      <div className="max-h-60 overflow-y-auto py-1">
        {results.length === 0 ? (
          <div className="px-3 py-3 text-sm text-zinc-400">No matches</div>
        ) : (
          <ul className="space-y-1">
            {results.map((page, index) => (
              <li key={page.id}>
                <button
                  type="button"
                  onClick={() => onSelect(page)}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    index === selectedIndex
                      ? 'bg-zinc-700 text-zinc-50'
                      : 'text-zinc-300 hover:bg-zinc-700/60 hover:text-zinc-50'
                  }`}
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-zinc-700/60 text-lg">
                    {page.icon ? page.icon : <FileText className="h-4 w-4 text-zinc-300" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{page.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
