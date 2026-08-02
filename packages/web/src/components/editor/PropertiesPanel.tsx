import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { clsx } from 'clsx';
import {
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  GripVertical,
  Link,
  Mail,
  Plus,
  Tag as TagIcon,
  Trash2,
  User,
  X,
} from 'lucide-react';
import type React from 'react';
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIsReadOnly } from '../../contexts/EditorReadOnlyContext';
import { useUpdatePage } from '../../hooks/use-pages';
import { usePropertyMetadata } from '../../hooks/usePropertyMetadata';
import { cleanTagName, tagIdentity } from '../../utils/tags';
import { showErrorToast } from '../../utils/toast';

interface PropertiesPanelProps {
  pageId: string;
  properties: Record<string, unknown> | null;
}

interface PropertyItem {
  id: string; // Truly stable internal ID
  key: string;
  value: unknown;
}

// --- Helpers ---

const getIconForKey = (key: string) => {
  const knownIcons: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
    date: Calendar,
    created: Calendar,
    updated: Calendar,
    author: User,
    user: User,
    owner: User,
    url: Link,
    link: Link,
    website: Link,
    email: Mail,
    time: Clock,
    duration: Clock,
    tags: TagIcon,
    tag: TagIcon,
  };
  return knownIcons[key.toLowerCase()] ?? null;
};

const isUrl = (val: string) => val.startsWith('http://') || val.startsWith('https://');

const isTagPropertyKey = (key: string) => {
  const normalizedKey = key.toLowerCase();
  return normalizedKey === 'tags' || normalizedKey === 'tag';
};

const normalizeTagPropertyValue = (value: unknown): string[] | null => {
  if (Array.isArray(value)) {
    const stringValues = value.filter(
      (candidate): candidate is string => typeof candidate === 'string',
    );
    if (stringValues.length !== value.length) {
      return null;
    }
    return stringValues;
  }
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') return value.trim().length > 0 ? [value] : [];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  return null;
};

// --- Sub-components ---

interface TagValueEditorProps {
  tags: string[];
  onChange: (newTags: string[]) => void;
  suggestions: string[];
  onBlur?: () => void;
  onSuggestionsOpen?: () => void;
}

const TagValueEditor = forwardRef<HTMLInputElement, TagValueEditorProps>(
  ({ tags, onChange, suggestions, onBlur, onSuggestionsOpen }, ref) => {
    const readOnly = useIsReadOnly();
    const [inputValue, setInputValue] = useState('');
    const [isFocused, setIsFocused] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);

    const filteredSuggestions = useMemo(() => {
      const existingTags = new Set(tags.map(tagIdentity));
      return suggestions.filter((suggestion) => {
        if (existingTags.has(tagIdentity(suggestion))) return false;
        return !inputValue || suggestion.toLowerCase().includes(inputValue.toLowerCase());
      });
    }, [inputValue, suggestions, tags]);

    const addTag = (tag: string) => {
      if (readOnly) return;
      const name = cleanTagName(tag);
      const identity = tagIdentity(name);
      if (identity && !tags.some((existing) => tagIdentity(existing) === identity)) {
        onChange([...tags, name]);
      }
      setInputValue('');
    };

    const removeTag = (tagToRemove: string) => {
      if (readOnly) return;
      onChange(tags.filter((t) => t !== tagToRemove));
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (readOnly) return;
      if (e.key === 'ArrowDown') {
        if (filteredSuggestions.length > 0) {
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % filteredSuggestions.length);
        }
      } else if (e.key === 'ArrowUp') {
        if (filteredSuggestions.length > 0) {
          e.preventDefault();
          setSelectedIndex(
            (prev) => (prev - 1 + filteredSuggestions.length) % filteredSuggestions.length,
          );
        }
      } else if (e.key === 'Enter' || e.key === 'Tab' || e.key === ',') {
        if (filteredSuggestions.length > 0 && (e.key === 'Enter' || e.key === 'Tab')) {
          e.preventDefault();
          const selected = filteredSuggestions[selectedIndex];
          if (selected) {
            addTag(selected);
          }
        } else {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            addTag(inputValue);
          }
        }
      } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
        const lastTag = tags[tags.length - 1];
        if (lastTag !== undefined) {
          removeTag(lastTag);
        }
      }
    };

    return (
      <div className="flex flex-wrap items-center gap-1.5 min-h-[1.75rem] py-0.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 text-[12px] rounded-full font-medium leading-none group/tag transition-colors"
          >
            {tag}
            {!readOnly && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeTag(tag);
                }}
                className="p-0.5 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
              >
                <X size={11} />
              </button>
            )}
          </span>
        ))}
        {!readOnly && (
          <div className="relative flex-1 min-w-[80px]">
            <input
              ref={ref}
              type="text"
              data-testid="tag-input"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setSelectedIndex(0);
              }}
              onKeyDown={handleKeyDown}
              onFocus={() => {
                setIsFocused(true);
                onSuggestionsOpen?.();
              }}
              onBlur={() => {
                setIsFocused(false);
                if (onBlur) onBlur();
              }}
              placeholder={tags.length === 0 ? 'Empty' : 'Add tag...'}
              className="w-full !bg-transparent !border-0 !border-none !shadow-none !outline-none text-[15px] py-0 px-1 placeholder:text-zinc-400 text-zinc-800 dark:text-zinc-200 caret-zinc-800 dark:caret-zinc-200 !focus:ring-0 !focus-visible:ring-0 !focus:outline-none !ring-0 !ring-offset-0 appearance-none"
              style={{
                border: 'none',
                outline: 'none',
                boxShadow: 'none',
                background: 'transparent',
              }}
            />
            {isFocused && filteredSuggestions.length > 0 && (
              <div className="absolute top-full left-0 mt-1 w-48 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-xl z-50 overflow-hidden py-1">
                {filteredSuggestions.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      addTag(s);
                    }}
                    className={clsx(
                      'w-full text-left px-3 py-1.5 text-[13px] transition-colors !outline-none !ring-0 !ring-offset-0 !focus:ring-0',
                      i === selectedIndex
                        ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                        : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  },
);
TagValueEditor.displayName = 'TagValueEditor';

interface PropertyKeySelectorProps {
  currentKey: string;
  onSelect: (newKey: string) => void;
  suggestions: string[];
  isEditing: boolean;
  setIsEditing: (val: boolean) => void;
}

function PropertyKeySelector({
  currentKey,
  onSelect,
  suggestions,
  isEditing,
  setIsEditing,
}: PropertyKeySelectorProps) {
  const readOnly = useIsReadOnly();
  const [inputValue, setInputValue] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasInteracted = useRef(false);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (readOnly && isEditing) {
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
      hasInteracted.current = false;
      setIsEditing(false);
    }
  }, [isEditing, readOnly, setIsEditing]);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  const filtered = useMemo(() => {
    const query = inputValue.toLowerCase();
    if (!query || inputValue === currentKey) return suggestions;
    return suggestions.filter((s) => s.toLowerCase().includes(query));
  }, [inputValue, suggestions, currentKey]);

  const showCreateOption =
    inputValue.trim().length > 0 && inputValue !== currentKey && filtered.length === 0;
  const totalItems = filtered.length + (showCreateOption ? 1 : 0);

  useEffect(() => {
    if (isEditing) {
      if (!hasInteracted.current) {
        setInputValue(currentKey === 'New Property' || currentKey === '' ? '' : currentKey);
      }
      const idx = suggestions.indexOf(currentKey);
      setSelectedIndex(idx >= 0 ? idx : 0);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    } else {
      hasInteracted.current = false;
    }
  }, [isEditing, currentKey, suggestions]);

  const handleSelect = (key: string) => {
    if (readOnly) return;
    onSelect(key);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (readOnly) return;
    if (e.key === 'ArrowDown') {
      if (totalItems > 0) {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % totalItems);
      }
    } else if (e.key === 'ArrowUp') {
      if (totalItems > 0) {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + totalItems) % totalItems);
      }
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (showCreateOption && selectedIndex === 0) {
        handleSelect(inputValue);
      } else if (filtered.length > 0) {
        const adjustedIndex = showCreateOption ? selectedIndex - 1 : selectedIndex;
        const selected = filtered[adjustedIndex];
        if (selected) handleSelect(selected);
      } else {
        handleSelect(inputValue || currentKey);
      }
    } else if (e.key === 'Escape') {
      setIsEditing(false);
    }
  };

  if (readOnly || !isEditing) {
    const IconComponent = getIconForKey(currentKey);
    return (
      <button
        type="button"
        onClick={() => !readOnly && setIsEditing(true)}
        className={clsx(
          'flex items-center gap-2 text-[13px] font-medium text-zinc-500 dark:text-zinc-400 truncate px-1.5 py-0.5 rounded transition-colors text-left w-36 shrink-0 group/key !outline-none !ring-0 !ring-offset-0 !focus:ring-0 !focus-visible:ring-0 !focus:outline-none !border-0 selection:bg-zinc-200 selection:text-zinc-800 dark:selection:bg-zinc-700 dark:selection:text-zinc-200',
          readOnly ? 'cursor-default' : 'cursor-text',
        )}
        style={{ border: 'none', outline: 'none', boxShadow: 'none', background: 'transparent' }}
      >
        {IconComponent && <IconComponent size={15} className="text-zinc-400 shrink-0" />}
        <span className="truncate">{currentKey || 'New Property'}</span>
      </button>
    );
  }

  return (
    <div className="relative w-36 shrink-0">
      <input
        ref={inputRef}
        type="text"
        data-testid="key-input"
        value={inputValue}
        onChange={(e) => {
          hasInteracted.current = true;
          setInputValue(e.target.value);
          setSelectedIndex(0);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (readOnly) return;
          blurTimeoutRef.current = setTimeout(() => {
            if (inputRef.current && !readOnly) {
              handleSelect(inputValue.trim() || currentKey);
            }
          }, 150);
        }}
        className="w-full text-[13px] font-medium !bg-transparent !border-0 !border-none !shadow-none !outline-none !focus:ring-0 !focus-visible:ring-0 !ring-0 !ring-offset-0 text-zinc-500 dark:text-zinc-400 px-1.5 py-0.5 rounded appearance-none"
        style={{ border: 'none', outline: 'none', boxShadow: 'none', background: 'transparent' }}
        placeholder="Property name..."
      />
      <div className="absolute top-full left-0 mt-1 w-48 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-xl z-50 overflow-hidden py-1">
        {showCreateOption && (
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              handleSelect(inputValue);
            }}
            className={clsx(
              'w-full text-left px-3 py-2 text-[13px] transition-colors flex items-center gap-2 !outline-none !ring-0 !ring-offset-0 !focus:ring-0',
              selectedIndex === 0
                ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
            )}
          >
            <Plus size={13} className="text-zinc-400 shrink-0" />
            <span>Create &ldquo;{inputValue}&rdquo;</span>
          </button>
        )}
        {filtered.map((s, i) => {
          const Svg = getIconForKey(s);
          const isCurrent = s === currentKey;
          const idx = showCreateOption ? i + 1 : i;
          return (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(s);
              }}
              className={clsx(
                'w-full text-left px-3 py-2 text-[13px] transition-colors flex items-center gap-2 !outline-none !ring-0 !ring-offset-0 !focus:ring-0',
                idx === selectedIndex
                  ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                  : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
              )}
            >
              {Svg && <Svg size={13} className="text-zinc-400 shrink-0" />}
              <span className="flex-1 truncate">{s}</span>
              {isCurrent && <Check size={13} className="text-zinc-400 shrink-0" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface SortablePropertyRowProps {
  item: PropertyItem;
  onUpdate: (id: string, value: unknown) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, newKey: string) => void;
  isNew?: boolean;
}

function SortablePropertyRow({
  item,
  onUpdate,
  onDelete,
  onRename,
  isNew,
  propertyKeySuggestions,
  tagSuggestions,
  refreshTags,
}: SortablePropertyRowProps & {
  propertyKeySuggestions: string[];
  tagSuggestions: string[];
  refreshTags: () => void;
}) {
  const readOnly = useIsReadOnly();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: readOnly,
  });

  const [isEditingValue, setIsEditingValue] = useState(false);
  const [tempValue, setTempValue] = useState(() => {
    if (Array.isArray(item.value)) return item.value.join(', ');
    return String(item.value ?? '');
  });

  const valueInputRef = useRef<HTMLInputElement>(null);
  const tagEditorRef = useRef<HTMLInputElement>(null);
  const [isEditingKey, setIsEditingKey] = useState(isNew ?? false);
  const valueSavePending = useRef(false);
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  };

  const handleValueSave = (nextValue?: unknown) => {
    if (readOnlyRef.current) {
      setIsEditingValue(false);
      setTempValue(Array.isArray(item.value) ? item.value.join(', ') : String(item.value ?? ''));
      return;
    }
    if (valueSavePending.current) return;
    setIsEditingValue(false);
    const finalValue = nextValue !== undefined ? nextValue : tempValue.trim();
    if (finalValue !== (Array.isArray(item.value) ? item.value.join(', ') : item.value)) {
      valueSavePending.current = true;
      onUpdate(item.id, finalValue);
    }
  };

  useEffect(() => {
    if (readOnly) {
      valueSavePending.current = false;
      setIsEditingValue(false);
      setIsEditingKey(false);
      setTempValue(Array.isArray(item.value) ? item.value.join(', ') : String(item.value ?? ''));
    }
  }, [item.value, readOnly]);

  useEffect(() => {
    if (isEditingValue) {
      valueSavePending.current = false;
      valueInputRef.current?.focus();
    }
  }, [isEditingValue]);

  const isTagsProperty = isTagPropertyKey(item.key);

  const handleKeySelect = useCallback(
    (newKey: string) => {
      if (readOnlyRef.current) return;
      onRename(item.id, newKey);
      // Auto-focus the value area after selecting a property key
      const isTag = isTagPropertyKey(newKey);
      if (isTag) {
        setTimeout(() => tagEditorRef.current?.focus(), 0);
      } else {
        setIsEditingValue(true);
      }
    },
    [item.id, onRename],
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-property-key={item.key}
      className={clsx(
        'group flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all duration-200 border border-transparent',
        isDragging
          ? 'bg-white dark:bg-zinc-800 shadow-xl border-zinc-200 dark:border-zinc-700'
          : 'hover:bg-zinc-100/50 dark:hover:bg-zinc-800/40',
      )}
    >
      {!readOnly && (
        <div
          {...attributes}
          {...listeners}
          className="opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing p-1 -ml-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-opacity"
        >
          <GripVertical size={15} />
        </div>
      )}

      <PropertyKeySelector
        currentKey={item.key}
        onSelect={handleKeySelect}
        suggestions={propertyKeySuggestions}
        isEditing={isEditingKey}
        setIsEditing={setIsEditingKey}
      />

      <div className="flex-1 min-w-0 flex items-center gap-2">
        {isTagsProperty ? (
          <TagValueEditor
            ref={tagEditorRef}
            tags={
              Array.isArray(item.value)
                ? item.value.filter((tag): tag is string => typeof tag === 'string')
                : []
            }
            suggestions={tagSuggestions}
            onChange={(newTags) => {
              if (!readOnlyRef.current) onUpdate(item.id, newTags);
            }}
            onSuggestionsOpen={refreshTags}
          />
        ) : isEditingValue ? (
          <input
            ref={valueInputRef}
            type="text"
            data-testid="value-input"
            className="flex-1 text-[15px] !bg-transparent !border-0 !border-none !shadow-none !outline-none !focus:ring-0 !focus-visible:ring-0 !ring-0 !ring-offset-0 text-zinc-800 dark:text-zinc-200 caret-zinc-800 dark:caret-zinc-200 px-2 py-0.5 min-h-[1.75rem] rounded truncate appearance-none"
            style={{
              border: 'none',
              outline: 'none',
              boxShadow: 'none',
              background: 'transparent',
            }}
            value={tempValue}
            onChange={(e) => setTempValue(e.target.value)}
            onBlur={() => handleValueSave()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleValueSave();
              if (e.key === 'Escape') {
                setIsEditingValue(false);
                setTempValue(
                  Array.isArray(item.value) ? item.value.join(', ') : String(item.value ?? ''),
                );
              }
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => !readOnly && setIsEditingValue(true)}
            className={clsx(
              'flex-1 text-[15px] text-zinc-800 dark:text-zinc-200 truncate px-2 py-0.5 rounded min-h-[1.75rem] flex items-center transition-colors text-left !outline-none !ring-0 !ring-offset-0 !focus:ring-0 !focus-visible:ring-0 !focus:outline-none !border-0 selection:bg-zinc-200 selection:text-zinc-800 dark:selection:bg-zinc-700 dark:selection:text-zinc-200',
              readOnly ? 'cursor-default' : 'cursor-text',
            )}
            style={{
              border: 'none',
              outline: 'none',
              boxShadow: 'none',
              background: 'transparent',
            }}
          >
            {isUrl(String(item.value)) ? (
              <a
                href={String(item.value)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1.5"
              >
                <span className="truncate">{String(item.value)}</span>
                <ExternalLink size={11} className="shrink-0" />
              </a>
            ) : (
              <span className={clsx(!item.value && 'text-zinc-400 dark:text-zinc-600')}>
                {String(item.value || 'Empty')}
              </span>
            )}
          </button>
        )}
      </div>

      {!readOnly && (
        <button
          type="button"
          data-testid="delete-property"
          onClick={() => onDelete(item.id)}
          className="opacity-0 group-hover:opacity-100 p-1.5 text-zinc-400 hover:text-red-500 transition-all cursor-pointer rounded-md hover:bg-red-50 dark:hover:bg-red-500/10 shrink-0 !outline-none !ring-0 !ring-offset-0 !focus:ring-0"
          title="Delete property"
        >
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );
}

// --- Main Component ---

export function PropertiesPanel({ pageId, properties }: PropertiesPanelProps) {
  const readOnly = useIsReadOnly();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [items, setItems] = useState<PropertyItem[]>([]);
  const [newPropertyId, setNewPropertyId] = useState<string | null>(null);
  const updatePage = useUpdatePage();
  const panelReadOnlyRef = useRef(readOnly);
  panelReadOnlyRef.current = readOnly;

  // Sync internal items with props while preserving order
  useEffect(() => {
    if (!properties) {
      setItems([]);
      return;
    }

    const propEntries = Object.entries(properties);

    setItems((currentItems) => {
      const newItems: PropertyItem[] = [];
      const handledKeys = new Set<string>();

      // 1. Keep existing items that are still in properties, update their values
      for (const item of currentItems) {
        if (item.id.startsWith('new-')) {
          newItems.push(item);
          handledKeys.add(item.key);
          continue;
        }

        if (Object.hasOwn(properties, item.key)) {
          newItems.push({
            ...item,
            value: properties[item.key],
          });
          handledKeys.add(item.key);
        }
      }

      // 2. Add new properties from the backend that aren't in our list yet
      for (const [key, value] of propEntries) {
        if (!handledKeys.has(key)) {
          newItems.push({
            id: key, // Use key as ID for existing properties from backend
            key,
            value,
          });
        }
      }

      return newItems;
    });
  }, [properties]);

  useEffect(() => {
    if (!readOnly) return;
    setNewPropertyId(null);
    setItems(Object.entries(properties ?? {}).map(([key, value]) => ({ id: key, key, value })));
  }, [properties, readOnly]);

  const {
    allKeys: propertyKeySuggestions,
    allTags: tagSuggestions,
    refreshTags,
  } = usePropertyMetadata();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const persistChanges = useCallback(
    (newItems: PropertyItem[]) => {
      if (panelReadOnlyRef.current) return;
      const nextProperties: Record<string, unknown> = {};
      for (const item of newItems) {
        const key = item.key.trim();
        if (!key) continue;

        const existing = nextProperties[key];
        if (existing !== undefined) {
          if (Array.isArray(existing) && Array.isArray(item.value)) {
            nextProperties[key] = [...new Set([...existing, ...item.value])];
          } else {
            nextProperties[key] = item.value;
          }
        } else {
          nextProperties[key] = item.value;
        }
      }
      updatePage.mutate({ pageId, updates: { properties: nextProperties }, silent: true });
    },
    [pageId, updatePage],
  );

  const handleDragEnd = (event: DragEndEvent) => {
    if (panelReadOnlyRef.current) return;
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setItems((prev) => {
        const oldIndex = prev.findIndex((i) => i.id === active.id);
        const newIndex = prev.findIndex((i) => i.id === over.id);
        const next = arrayMove(prev, oldIndex, newIndex);
        persistChanges(next);
        return next;
      });
    }
  };

  const updateProperty = (id: string, value: unknown) => {
    if (panelReadOnlyRef.current) return;
    setItems((prev) => {
      const next = prev.map((it) => (it.id === id ? { ...it, value } : it));
      persistChanges(next);
      return next;
    });
  };

  const deleteProperty = (id: string) => {
    if (panelReadOnlyRef.current) return;
    setItems((prev) => {
      const next = prev.filter((it) => it.id !== id);
      persistChanges(next);
      return next;
    });
  };

  const renameProperty = (id: string, newKey: string) => {
    if (panelReadOnlyRef.current) return;
    const currentItem = items.find((item) => item.id === id);
    const nextValue = isTagPropertyKey(newKey)
      ? normalizeTagPropertyValue(currentItem?.value)
      : currentItem?.value;
    if (isTagPropertyKey(newKey) && nextValue === null) {
      showErrorToast('Tags can only contain string values');
      return;
    }

    setItems((currentItems) => {
      if (!newKey || currentItems.some((it) => it.id !== id && it.key === newKey)) {
        return [...currentItems]; // Trigger re-render to revert invalid input
      }
      const next = currentItems.map((it) =>
        it.id === id
          ? {
              ...it,
              key: newKey,
              value: isTagPropertyKey(newKey) ? nextValue : it.value,
            }
          : it,
      );
      persistChanges(next);
      return next;
    });
    setNewPropertyId(null);
  };

  const addProperty = () => {
    if (panelReadOnlyRef.current) return;
    const newId = `new-${Math.random().toString(36).slice(2, 11)}`;
    setItems((prev) => [...prev, { id: newId, key: '', value: '' }]);
    setNewPropertyId(newId);
    setIsCollapsed(false);
  };

  if (items.length === 0 && !isCollapsed) {
    if (readOnly) {
      return (
        <div className="mb-6 animate-fade-in px-2">
          <span className="flex items-center gap-2 px-3 py-1.5 text-[13px] font-medium text-zinc-400 dark:text-zinc-500">
            No properties
          </span>
        </div>
      );
    }
    return (
      <div className="mb-6 animate-fade-in px-2">
        <button
          type="button"
          data-testid="add-property"
          onClick={addProperty}
          className="flex items-center gap-2 px-3 py-1.5 text-[13px] font-medium text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-all cursor-pointer group border border-dashed border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 !outline-none !focus:outline-none !focus:ring-0 !focus-visible:ring-0 !ring-0 !ring-offset-0"
        >
          <Plus size={15} className="group-hover:scale-110 transition-transform" />
          Add a property
        </button>
      </div>
    );
  }

  return (
    <div className="mb-10 select-none animate-fade-in">
      <div className="flex items-center justify-between mb-3 px-2">
        <button
          type="button"
          data-testid="properties-heading"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-600 dark:text-zinc-300 cursor-pointer group !outline-none !focus:outline-none !focus:ring-0 !focus-visible:ring-0 !ring-0 !ring-offset-0"
        >
          <div className="p-0.5 rounded">
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </div>
          <span>Properties</span>
          <span
            data-testid="property-count"
            className="bg-zinc-100 dark:bg-zinc-800/80 px-2 py-0.5 rounded-full text-[11px] normal-case tracking-normal font-black"
          >
            {items.length}
          </span>
        </button>
      </div>

      {!isCollapsed && (
        <div className="space-y-1">
          <DndContext
            key={readOnly ? 'read-only' : 'editable'}
            sensors={readOnly ? [] : sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={items} strategy={verticalListSortingStrategy}>
              {items.map((item) => (
                <SortablePropertyRow
                  key={item.id}
                  item={item}
                  isNew={newPropertyId === item.id}
                  onUpdate={updateProperty}
                  onDelete={deleteProperty}
                  onRename={renameProperty}
                  propertyKeySuggestions={propertyKeySuggestions}
                  tagSuggestions={tagSuggestions}
                  refreshTags={refreshTags}
                />
              ))}
            </SortableContext>
          </DndContext>

          {!readOnly && (
            <button
              type="button"
              data-testid="add-property"
              onClick={addProperty}
              className="w-full flex items-center gap-2 px-2 py-2 mt-2 text-[13px] font-medium text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100/50 dark:hover:bg-zinc-800/40 rounded-lg transition-all cursor-pointer group border border-dashed border-transparent hover:border-zinc-200 dark:hover:border-zinc-700 !outline-none !focus:outline-none !focus:ring-0 !focus-visible:ring-0 !ring-0 !ring-offset-0"
            >
              <Plus size={15} className="group-hover:scale-110 transition-transform" />
              <span>Add a property</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
