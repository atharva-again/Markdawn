import {
  MAX_FOLDER_NAME_LENGTH,
  MAX_PAGE_TITLE_LENGTH,
  type SharePermission,
  truncateUnicodeCodePoints,
} from '@markdawn/shared';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, FileText, Plus } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useIdentityNavigate } from '../../contexts/IdentityLifecycleContext';
import { buildEntityPath, buildFolderPath } from '../../utils/url';
import { PageContextMenu } from '../ui/PageContextMenu';

interface PageTreeRowProps {
  id: string;
  title: string;
  icon?: string | null | undefined;
  ownerId?: string | null | undefined;
  createdBy?: string | null | undefined;
  userPermission?: SharePermission | null | undefined;
  shareSource?: 'direct' | 'public' | 'workspace' | undefined;
  parentId?: string | null | undefined;
  canMove?: boolean | undefined;
  isActive?: boolean;
  depth?: number;
  hasChildren?: boolean;
  isExpanded?: boolean;
  isFavorite?: boolean;
  showDragHandle?: boolean;
  onToggleExpand?: (() => void) | undefined;
  onCreateChild?: (() => void) | undefined;
  onNavigate?: (() => void) | undefined;
  onRename?: (() => void) | undefined;
  isEditing?: boolean;
  editTitle?: string;
  onEditChange?: ((value: string) => void) | undefined;
  onEditSave?: (() => void) | undefined;
  onEditKeyDown?: ((e: React.KeyboardEvent) => void) | undefined;
  isDragTarget?: boolean;
  isFolder?: boolean;
}

export function PageTreeRow({
  id,
  title,
  icon,
  ownerId,
  createdBy,
  userPermission,
  shareSource,
  parentId,
  canMove,
  isActive = false,
  depth = 0,
  hasChildren = false,
  isExpanded = false,
  isFavorite = false,
  showDragHandle = false,
  onToggleExpand,
  onCreateChild,
  onNavigate,
  onRename,
  isEditing = false,
  editTitle = '',
  onEditChange,
  onEditSave,
  onEditKeyDown,
  isDragTarget = false,
  isFolder = false,
}: PageTreeRowProps) {
  const navigate = useIdentityNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const editLengthLimit = isFolder ? MAX_FOLDER_NAME_LENGTH : MAX_PAGE_TITLE_LENGTH;

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleNavigate = () => {
    if (onNavigate) {
      onNavigate();
    } else {
      navigate(buildEntityPath(isFolder ? 'folder' : 'page', title, id));
    }
  };

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleExpand) onToggleExpand();
  };

  const handleCreateChild = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onCreateChild) onCreateChild();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={clsx(
        'group relative flex h-8 items-center rounded-lg py-1 pr-2 cursor-pointer transition-colors duration-150',
        isActive
          ? 'bg-zinc-200/75 text-zinc-950 font-medium shadow-[inset_0_0_0_1px_rgba(24,24,27,0.03)] dark:bg-zinc-800/90 dark:text-zinc-100 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]'
          : 'text-zinc-600 hover:bg-zinc-100/90 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100',
        isDragTarget && 'opacity-60',
      )}
      style={{ paddingLeft: `${depth * 14 + 8}px`, marginLeft: '6px', marginRight: '6px' }}
      onClick={handleNavigate}
      onKeyDown={(e) => {
        if (isEditing) return;
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleNavigate();
        }
      }}
      data-testid="page-tree-row"
      data-entity-id={id}
      data-entity-type={isFolder ? 'folder' : 'page'}
    >
      <button
        type="button"
        onClick={hasChildren ? handleToggleExpand : undefined}
        className={clsx(
          'mr-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors',
          showDragHandle ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
          hasChildren
            ? 'text-zinc-400 hover:bg-black/5 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-white/10 dark:hover:text-zinc-300'
            : 'text-zinc-400 opacity-55 dark:text-zinc-500',
        )}
        aria-label={hasChildren ? 'Toggle nested pages' : 'Page'}
      >
        {hasChildren ? (
          isExpanded ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronRight size={14} />
          )
        ) : isFolder ? (
          <span className="text-sm leading-none">📁</span>
        ) : icon ? (
          <span className="text-sm leading-none">{icon}</span>
        ) : (
          <FileText
            size={14}
            className={clsx(
              isActive ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 dark:text-zinc-500',
            )}
          />
        )}
      </button>

      <div
        className={clsx(
          'flex-1 flex items-center min-w-0 transition-[padding] duration-150',
          isMenuOpen ? 'pr-14' : 'pr-2 group-hover:pr-14',
        )}
      >
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            maxLength={editLengthLimit * 2}
            value={editTitle}
            onChange={(e) =>
              onEditChange?.(truncateUnicodeCodePoints(e.target.value, editLengthLimit))
            }
            onBlur={onEditSave}
            onKeyDown={onEditKeyDown}
            className="h-6 min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-400/60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-zinc-500/60"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="truncate text-sm leading-none">{title}</span>
        )}
      </div>

      {!isEditing && (
        <div
          className={clsx(
            'absolute right-1.5 z-20 flex items-center gap-0.5 transition-opacity',
            isMenuOpen
              ? 'opacity-100 pointer-events-auto'
              : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto',
          )}
        >
          {onCreateChild && (
            <button
              type="button"
              onClick={handleCreateChild}
              className="p-1 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer transition-colors"
              title="Add page"
            >
              <Plus size={14} />
            </button>
          )}

          <PageContextMenu
            item={{
              id,
              type: isFolder ? 'folder' : 'page',
              title,
              icon: icon ?? null,
              ...(ownerId != null ? { ownerId } : {}),
              ...(createdBy != null ? { createdBy } : {}),
              ...(userPermission !== undefined ? { userPermission } : {}),
              ...(shareSource !== undefined ? { shareSource } : {}),
              ...(canMove !== undefined ? { canMove } : {}),
            }}
            isFavorite={isFavorite}
            triggerClassName="p-1 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer transition-colors"
            menuClassName="w-40 bg-white dark:bg-zinc-900 border border-black/5 dark:border-white/5 shadow-[0_8px_30px_rgb(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.5)] rounded-2xl p-1.5 flex flex-col z-[9999]"
            onOpenChange={setIsMenuOpen}
            {...(onRename != null ? { onRename } : {})}
            {...(isActive
              ? {
                  onDeleted: () =>
                    navigate(parentId ? buildFolderPath('folder', parentId) : '/app'),
                }
              : {})}
          />
        </div>
      )}
    </div>
  );
}
