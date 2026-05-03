import type { FolderTreeNode } from '@markdawn/shared';
import {
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  FolderPlus,
  Home,
  LayoutGrid,
  List,
} from 'lucide-react';
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ExplorerItem, type ExplorerItemData } from '../components/workspace/ExplorerItem';
import { MoveDialog } from '../components/workspace/MoveDialog';
import { SelectionToolbar } from '../components/workspace/SelectionToolbar';
import { useClipboard } from '../contexts/ClipboardContext';
import { useSelection } from '../contexts/SelectionContext';
import {
  useBulkDeleteFolders,
  useBulkDeletePages,
  useBulkMoveFolders,
  useBulkMovePages,
} from '../hooks/use-bulk-actions';
import { useCopyFolder, useCopyPage } from '../hooks/use-copy';
import {
  useCreateFolder,
  useDeleteFolder,
  useFolderTree,
  useUpdateFolder,
} from '../hooks/use-folders';
import { useCreatePage, useDeletePage, usePageTree, useUpdatePage } from '../hooks/use-pages';
import { useWorkspace } from '../hooks/use-workspaces';
import { showErrorToast, showSuccessToast } from '../utils/toast';

export default function Workspace() {
  const navigate = useNavigate();
  const { workspaceSlug, folderId } = useParams<{ workspaceSlug: string; folderId?: string }>();
  const { data: workspace } = useWorkspace(workspaceSlug);
  const {
    data: pages,
    isLoading: isPagesLoading,
    error: pagesError,
    refetch: refetchPages,
  } = usePageTree(workspace?.id ?? '');
  const {
    data: folders,
    isLoading: isFoldersLoading,
    error: foldersError,
  } = useFolderTree(workspace?.id ?? '');

  const createPageMutation = useCreatePage();
  const createFolderMutation = useCreateFolder();
  const updatePageMutation = useUpdatePage();
  const updateFolderMutation = useUpdateFolder();
  const deletePageMutation = useDeletePage();
  const deleteFolderMutation = useDeleteFolder();
  const copyPageMutation = useCopyPage();
  const copyFolderMutation = useCopyFolder();
  const bulkDeletePagesMutation = useBulkDeletePages();
  const bulkDeleteFoldersMutation = useBulkDeleteFolders();
  const bulkMovePagesMutation = useBulkMovePages();
  const bulkMoveFoldersMutation = useBulkMoveFolders();

  const clipboard = useClipboard();
  const selection = useSelection();

  const [viewMode, setViewMode] = useState<'card' | 'list'>(() => {
    const saved = localStorage.getItem('markdawn:viewMode');
    return saved === 'list' ? 'list' : 'card';
  });
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<{
    kind: 'page' | 'folder';
    id: string;
    value: string;
  } | null>(null);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const newMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (workspace && workspaceSlug && workspace.slug !== workspaceSlug) {
      navigate(`/app/${workspace.slug}`, { replace: true });
    }
  }, [navigate, workspace, workspaceSlug]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: selection.clear is stable (useCallback + useMemo) but linter can't detect it; deps are workspaceSlug/folderId intentionally
  useEffect(() => {
    selection.clear();
    setLastSelectedIndex(null);
  }, [workspaceSlug, folderId]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (newMenuRef.current && !newMenuRef.current.contains(event.target as Node)) {
        setShowNewMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const breadcrumbPath = useMemo(() => {
    if (!folderId) return [];
    const path: FolderTreeNode[] = [];
    const find = (nodes: FolderTreeNode[]): boolean => {
      for (const node of nodes) {
        if (node.id === folderId) {
          path.push(node);
          return true;
        }
        if (node.children.length > 0) {
          if (find(node.children)) {
            path.unshift(node);
            return true;
          }
        }
      }
      return false;
    };
    find(folders ?? []);
    return path;
  }, [folders, folderId]);

  const currentFolders = useMemo(() => {
    if (!folderId) return folders ?? [];
    const find = (nodes: FolderTreeNode[]): FolderTreeNode[] => {
      for (const node of nodes) {
        if (node.id === folderId) return node.children;
        const found = find(node.children);
        if (found.length > 0) return found;
      }
      return [];
    };
    return find(folders ?? []);
  }, [folders, folderId]);

  const currentPages = useMemo(() => {
    return (pages ?? []).filter((page) => (page.parentId ?? null) === (folderId ?? null));
  }, [pages, folderId]);

  const allItems: ExplorerItemData[] = useMemo(() => {
    const folderItems: ExplorerItemData[] = currentFolders.map((f) => ({
      id: f.id,
      type: 'folder',
      title: f.name,
      icon: f.icon,
      updatedAt: f.updatedAt,
    }));
    const pageItems: ExplorerItemData[] = currentPages.map((p) => ({
      id: p.id,
      type: 'page',
      title: p.title,
      icon: p.icon,
      updatedAt: p.updatedAt,
      coverType: p.coverType,
      coverValue: p.coverValue,
    }));
    return [...folderItems, ...pageItems];
  }, [currentFolders, currentPages]);

  const handleCreatePage = async () => {
    if (!workspace?.id) return;
    try {
      const newPage = await createPageMutation.mutateAsync({
        workspaceId: workspace.id,
        ...(folderId ? { parentId: folderId } : {}),
      });
      navigate(`/app/${workspace.slug}/${newPage.id}`);
    } catch {
      showErrorToast('Failed to create page');
    }
  };

  const handleCreateFolder = async () => {
    if (!workspace?.id) return;
    try {
      const folder = await createFolderMutation.mutateAsync({
        workspaceId: workspace.id,
        ...(folderId ? { parentId: folderId } : {}),
      });
      setEditingTarget({ kind: 'folder', id: folder.id, value: folder.name });
    } catch {
      showErrorToast('Failed to create folder');
    }
  };

  const handleItemClick = (item: ExplorerItemData, index: number, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      selection.toggle({ id: item.id, type: item.type });
      setLastSelectedIndex(index);
    } else if (e.shiftKey && lastSelectedIndex !== null) {
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      const range = allItems.slice(start, end + 1).map((i) => ({ id: i.id, type: i.type }));
      selection.selectAll(range);
    } else {
      if (item.type === 'folder') {
        navigate(`/app/${workspaceSlug}/folder/${item.id}`);
      } else {
        navigate(`/app/${workspaceSlug}/${item.id}`);
      }
    }
  };

  const handleDeleteItem = async (item: ExplorerItemData) => {
    try {
      if (item.type === 'page') {
        await deletePageMutation.mutateAsync(item.id);
      } else {
        await deleteFolderMutation.mutateAsync({ folderId: item.id });
      }
      selection.deselect(item.id);
    } catch {
      showErrorToast('Failed to delete');
    }
  };

  const handleRenameItem = (item: ExplorerItemData) => {
    setEditingTarget({ kind: item.type, id: item.id, value: item.title });
  };

  const handleSaveRename = async () => {
    if (!editingTarget || !workspace?.id) return;
    const trimmed = editingTarget.value.trim();
    try {
      if (editingTarget.kind === 'folder') {
        await updateFolderMutation.mutateAsync({
          folderId: editingTarget.id,
          updates: { name: trimmed.length > 0 ? trimmed : 'New Folder' },
        });
      } else {
        await updatePageMutation.mutateAsync({
          pageId: editingTarget.id,
          updates: { title: trimmed.length > 0 ? trimmed : 'Untitled' },
        });
      }
    } catch {
      showErrorToast('Failed to rename');
    }
    setEditingTarget(null);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      void handleSaveRename();
    } else if (e.key === 'Escape') {
      setEditingTarget(null);
    }
  };

  const handleExport = async (pageId: string, title: string) => {
    try {
      const res = await fetch(`/api/pages/${pageId}/export/markdown`);
      if (!res.ok) throw new Error('Failed to export');
      const blob = await res.blob();
      const disposition = res.headers.get('content-disposition');
      const match = disposition?.match(/filename="?([^";]+)"?/i);
      const filename = match?.[1] ?? `${title || 'page'}.md`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showSuccessToast('Exported to markdown');
    } catch {
      showErrorToast('Failed to export');
    }
  };

  const handleBulkDelete = async () => {
    if (!workspace?.id) return;
    const pageIds = selection.selectedItems.filter((i) => i.type === 'page').map((i) => i.id);
    const folderIds = selection.selectedItems.filter((i) => i.type === 'folder').map((i) => i.id);

    try {
      if (pageIds.length > 0)
        await bulkDeletePagesMutation.mutateAsync({ pageIds, workspaceId: workspace.id });
      if (folderIds.length > 0)
        await bulkDeleteFoldersMutation.mutateAsync({ folderIds, workspaceId: workspace.id });
      selection.clear();
    } catch {
      showErrorToast('Failed to delete items');
    }
  };

  const handleBulkCopy = () => {
    clipboard.copy(selection.selectedItems);
    showSuccessToast('Copied to clipboard');
  };

  const handleBulkCut = () => {
    clipboard.cut(selection.selectedItems);
    showSuccessToast('Cut to clipboard');
  };

  const handleBulkMove = () => {
    setMoveDialogOpen(true);
  };

  const handleConfirmMove = async (targetFolderId: string | null) => {
    if (!workspace?.id) return;
    const pageIds = selection.selectedItems.filter((i) => i.type === 'page').map((i) => i.id);
    const folderIds = selection.selectedItems.filter((i) => i.type === 'folder').map((i) => i.id);

    try {
      if (pageIds.length > 0)
        await bulkMovePagesMutation.mutateAsync({
          pageIds,
          parentId: targetFolderId,
          workspaceId: workspace.id,
        });
      if (folderIds.length > 0)
        await bulkMoveFoldersMutation.mutateAsync({
          folderIds,
          parentId: targetFolderId,
          workspaceId: workspace.id,
        });
      selection.clear();
      setMoveDialogOpen(false);
    } catch {
      showErrorToast('Failed to move items');
    }
  };

  const handlePaste = async () => {
    if (!clipboard.state.action || clipboard.state.items.length === 0 || !workspace?.id) return;
    const currentParentId = folderId ?? null;

    try {
      if (clipboard.state.action === 'copy') {
        for (const item of clipboard.state.items) {
          if (item.type === 'page') {
            await copyPageMutation.mutateAsync({
              pageId: item.id,
              parentId: currentParentId,
              workspaceId: workspace.id,
            });
          } else {
            await copyFolderMutation.mutateAsync({
              folderId: item.id,
              parentId: currentParentId,
              workspaceId: workspace.id,
            });
          }
        }
        showSuccessToast('Pasted');
      } else if (clipboard.state.action === 'cut') {
        const pageIds = clipboard.state.items.filter((i) => i.type === 'page').map((i) => i.id);
        const folderIds = clipboard.state.items.filter((i) => i.type === 'folder').map((i) => i.id);
        if (pageIds.length > 0)
          await bulkMovePagesMutation.mutateAsync({
            pageIds,
            parentId: currentParentId,
            workspaceId: workspace.id,
          });
        if (folderIds.length > 0)
          await bulkMoveFoldersMutation.mutateAsync({
            folderIds,
            parentId: currentParentId,
            workspaceId: workspace.id,
          });
        clipboard.clear();
        showSuccessToast('Moved');
      }
    } catch {
      showErrorToast('Failed to paste');
    }
  };

  const handleCopyItem = (item: ExplorerItemData) => {
    selection.clear();
    selection.select({ id: item.id, type: item.type });
    clipboard.copy([{ id: item.id, type: item.type }]);
    showSuccessToast('Copied to clipboard');
  };

  const handleCutItem = (item: ExplorerItemData) => {
    selection.clear();
    selection.select({ id: item.id, type: item.type });
    clipboard.cut([{ id: item.id, type: item.type }]);
    showSuccessToast('Cut to clipboard');
  };

  const handleMoveItem = (item: ExplorerItemData) => {
    selection.clear();
    selection.select({ id: item.id, type: item.type });
    setMoveDialogOpen(true);
  };

  const isLoading = isPagesLoading || isFoldersLoading;
  const hasError = pagesError || foldersError;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400 flex-wrap">
          <Link
            to={`/app/${workspaceSlug}`}
            className="flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          >
            <Home size={14} />
            <span className="font-medium">{workspace?.name || workspaceSlug}</span>
          </Link>
          {breadcrumbPath.map((folder) => (
            <React.Fragment key={folder.id}>
              <ChevronRight size={14} className="mx-1" />
              <Link
                to={`/app/${workspaceSlug}/folder/${folder.id}`}
                className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
              >
                {folder.name}
              </Link>
            </React.Fragment>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {folderId
              ? breadcrumbPath[breadcrumbPath.length - 1]?.name || 'Folder'
              : workspace?.name || workspaceSlug}
          </h1>
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => {
                  setViewMode('card');
                  localStorage.setItem('markdawn:viewMode', 'card');
                }}
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${viewMode === 'card' ? 'bg-white dark:bg-zinc-700 shadow-sm text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'}`}
                title="Card view"
              >
                <LayoutGrid size={16} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode('list');
                  localStorage.setItem('markdawn:viewMode', 'list');
                }}
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${viewMode === 'list' ? 'bg-white dark:bg-zinc-700 shadow-sm text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'}`}
                title="List view"
              >
                <List size={16} />
              </button>
            </div>
            <div className="relative flex items-stretch" ref={newMenuRef}>
              <button
                type="button"
                onClick={handleCreatePage}
                className="flex items-center gap-1.5 pl-3 pr-2 h-7 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-l-lg text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors cursor-pointer border border-zinc-200 dark:border-zinc-700 border-r-0"
              >
                <FilePlus2 size={14} />
                <span className="hidden sm:inline">New Page</span>
              </button>
              <button
                type="button"
                onClick={() => setShowNewMenu((prev) => !prev)}
                className="flex items-center px-1.5 h-7 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-r-lg text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors cursor-pointer border border-zinc-200 dark:border-zinc-700"
              >
                <ChevronDown size={14} />
              </button>
              {showNewMenu && (
                <div className="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xl z-50 p-1.5 flex flex-col animate-scale-in origin-top-right">
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewMenu(false);
                      void handleCreatePage();
                    }}
                    className="flex items-center gap-2.5 px-2.5 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/10 w-full text-left cursor-pointer rounded-xl transition-colors"
                  >
                    <FilePlus2 size={14} /> New Page
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewMenu(false);
                      void handleCreateFolder();
                    }}
                    className="flex items-center gap-2.5 px-2.5 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/10 w-full text-left cursor-pointer rounded-xl transition-colors"
                  >
                    <FolderPlus size={14} /> New Folder
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {hasError ? (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-md flex items-center justify-between">
          <span>Failed to load items.</span>
          <button
            type="button"
            onClick={() => refetchPages()}
            className="px-3 py-1 bg-red-100 dark:bg-red-900/40 hover:bg-red-200 dark:hover:bg-red-900/60 rounded text-sm transition-colors"
          >
            Retry
          </button>
        </div>
      ) : isLoading ? (
        <div
          className={`${viewMode === 'card' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4' : 'space-y-1'} animate-fade-in`}
        >
          {[1, 2, 3, 4, 5, 6].map((id) => (
            <div
              key={id}
              className="block p-5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl"
            >
              <div className="h-28 bg-zinc-100 dark:bg-zinc-800 rounded-lg mb-3 animate-pulse" />
              <div className="h-5 bg-zinc-100 dark:bg-zinc-800 rounded w-3/4 mb-2 animate-pulse" />
              <div className="h-4 bg-zinc-100 dark:bg-zinc-800 rounded w-1/2 animate-pulse" />
            </div>
          ))}
        </div>
      ) : allItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileText size={48} className="text-zinc-300 dark:text-zinc-600 mb-4" />
          <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-50 mb-2">No items yet</h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-sm">
            Create a new page or folder to get started.
          </p>
        </div>
      ) : viewMode === 'card' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-in">
          {allItems.map((item, index) => (
            <ExplorerItem
              key={`${item.type}-${item.id}`}
              item={item}
              viewMode="card"
              isSelected={selection.isSelected(item.id)}
              workspaceSlug={workspaceSlug ?? ''}
              onSelect={(e) => {
                e.stopPropagation();
                selection.toggle({ id: item.id, type: item.type });
              }}
              onNavigate={(e) => handleItemClick(item, index, e)}
              onDelete={() => void handleDeleteItem(item)}
              onRename={() => handleRenameItem(item)}
              onCopy={() => handleCopyItem(item)}
              onCut={() => handleCutItem(item)}
              onMove={() => handleMoveItem(item)}
              {...(item.type === 'page'
                ? { onExport: () => void handleExport(item.id, item.title) }
                : {})}
              isEditing={editingTarget?.kind === item.type && editingTarget.id === item.id}
              editValue={editingTarget?.value ?? ''}
              onEditChange={(value) =>
                setEditingTarget((prev) => (prev ? { ...prev, value } : null))
              }
              onEditSave={() => void handleSaveRename()}
              onEditKeyDown={handleEditKeyDown}
            />
          ))}
        </div>
      ) : (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden animate-fade-in">
          <div className="grid grid-cols-[auto_auto_1fr_auto_auto] gap-3 px-4 py-2 text-xs font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
            <span className="w-5" />
            <span className="w-8" />
            <span>Name</span>
            <span className="hidden md:block w-32 text-right">Last edited</span>
            <span className="w-8" />
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {allItems.map((item, index) => (
              <ExplorerItem
                key={`${item.type}-${item.id}`}
                item={item}
                viewMode="list"
                isSelected={selection.isSelected(item.id)}
                workspaceSlug={workspaceSlug ?? ''}
                onSelect={(e) => {
                  e.stopPropagation();
                  selection.toggle({ id: item.id, type: item.type });
                }}
                onNavigate={(e) => handleItemClick(item, index, e)}
                onDelete={() => void handleDeleteItem(item)}
                onRename={() => handleRenameItem(item)}
                onCopy={() => handleCopyItem(item)}
                onCut={() => handleCutItem(item)}
                onMove={() => handleMoveItem(item)}
                {...(item.type === 'page'
                  ? { onExport: () => void handleExport(item.id, item.title) }
                  : {})}
                isEditing={editingTarget?.kind === item.type && editingTarget.id === item.id}
                editValue={editingTarget?.value ?? ''}
                onEditChange={(value) =>
                  setEditingTarget((prev) => (prev ? { ...prev, value } : null))
                }
                onEditSave={() => void handleSaveRename()}
                onEditKeyDown={handleEditKeyDown}
              />
            ))}
          </div>
        </div>
      )}

      <SelectionToolbar
        selectedCount={selection.selectedCount}
        totalCount={allItems.length}
        clipboardCount={clipboard.state.items.length}
        onDelete={handleBulkDelete}
        onCopy={handleBulkCopy}
        onCut={handleBulkCut}
        onMove={handleBulkMove}
        onPaste={() => void handlePaste()}
        onSelectAll={() => selection.selectAll(allItems.map((i) => ({ id: i.id, type: i.type })))}
        onClear={() => {
          selection.clear();
          clipboard.clear();
        }}
      />

      <MoveDialog
        isOpen={moveDialogOpen}
        folders={folders ?? []}
        onClose={() => setMoveDialogOpen(false)}
        onConfirm={handleConfirmMove}
      />
    </div>
  );
}
