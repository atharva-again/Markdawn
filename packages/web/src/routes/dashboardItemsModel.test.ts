import { describe, expect, it } from 'vitest';
import type { Favorite } from '../hooks/use-favorites';
import { createMockFolderTreeNode, createMockPageTreeNode } from '../test-utils/factories';
import { buildFavoriteDashboardItems } from './dashboardItemsModel';

const WORKSPACE_OWNER_ID = 'workspace-owner';
const CURRENT_USER_ID = 'workspace-admin';

function favorite(
  entityType: 'page' | 'folder',
  entityId: string,
  shareSource?: Favorite['shareSource'],
): Favorite {
  return {
    entityType,
    entityId,
    ...(entityType === 'page' ? { pageId: entityId } : {}),
    title: 'Favorite',
    icon: null,
    ownerId: WORKSPACE_OWNER_ID,
    ...(shareSource ? { shareSource } : {}),
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('buildFavoriteDashboardItems', () => {
  it('uses the canonical workspace source for a nested workspace favorite', () => {
    const page = createMockPageTreeNode({
      id: 'nested-page',
      parentId: 'nested-folder',
      title: 'Nested favorite',
      ownerId: WORKSPACE_OWNER_ID,
      userPermission: 'admin',
      workspaceAccess: true,
    });

    const items = buildFavoriteDashboardItems({
      activeFilter: 'shared-with-me',
      allItems: [],
      collaboratorsByFolderId: undefined,
      collaboratorsByPageId: undefined,
      currentUserId: CURRENT_USER_ID,
      favorites: [favorite('page', page.id, 'workspace')],
      folders: [],
      pages: [page],
      workspaceAdminOwnerIds: new Set([WORKSPACE_OWNER_ID]),
    });

    expect(items).toEqual([
      expect.objectContaining({
        id: page.id,
        type: 'page',
        title: page.title,
        canMove: true,
        shareSource: 'workspace',
      }),
    ]);
  });

  it('uses the canonical workspace source for a workspace folder favorite', () => {
    const folder = createMockFolderTreeNode({
      id: 'workspace-folder',
      ownerId: WORKSPACE_OWNER_ID,
      workspaceAccess: true,
    });

    const [item] = buildFavoriteDashboardItems({
      activeFilter: 'shared-with-me',
      allItems: [],
      collaboratorsByFolderId: undefined,
      collaboratorsByPageId: undefined,
      currentUserId: CURRENT_USER_ID,
      favorites: [favorite('folder', folder.id, 'workspace')],
      folders: [folder],
      pages: [],
      workspaceAdminOwnerIds: new Set(),
    });

    expect(item?.shareSource).toBe('workspace');
  });

  it('filters favorite-only folders by the active dashboard filter', () => {
    const folder = createMockFolderTreeNode({
      id: 'owned-folder',
      ownerId: CURRENT_USER_ID,
      name: 'Owned favorite',
    });
    const options = {
      allItems: [],
      collaboratorsByFolderId: undefined,
      collaboratorsByPageId: undefined,
      currentUserId: CURRENT_USER_ID,
      favorites: [favorite('folder', folder.id)],
      folders: [folder],
      pages: [],
      workspaceAdminOwnerIds: new Set<string>(),
    };

    expect(buildFavoriteDashboardItems({ ...options, activeFilter: 'owned-by-me' })).toHaveLength(
      1,
    );
    expect(
      buildFavoriteDashboardItems({ ...options, activeFilter: 'shared-with-me' }),
    ).toHaveLength(0);
  });

  it('preserves a direct share for a favorite nested under a shared folder', () => {
    const sharedFolder = createMockFolderTreeNode({
      id: 'shared-folder',
      ownerId: WORKSPACE_OWNER_ID,
    });
    const page = createMockPageTreeNode({
      id: 'directly-shared-page',
      parentId: sharedFolder.id,
      ownerId: WORKSPACE_OWNER_ID,
    });

    const [item] = buildFavoriteDashboardItems({
      activeFilter: 'shared-with-me',
      allItems: [],
      collaboratorsByFolderId: undefined,
      collaboratorsByPageId: undefined,
      currentUserId: CURRENT_USER_ID,
      favorites: [favorite('page', page.id, 'direct')],
      folders: [sharedFolder],
      pages: [page],
      workspaceAdminOwnerIds: new Set(),
    });

    expect(item?.shareSource).toBe('direct');
  });

  it('preserves a public visit source for a favorite-only page', () => {
    const page = createMockPageTreeNode({
      id: 'public-page',
      ownerId: WORKSPACE_OWNER_ID,
    });

    const [item] = buildFavoriteDashboardItems({
      activeFilter: 'shared-with-me',
      allItems: [],
      collaboratorsByFolderId: undefined,
      collaboratorsByPageId: undefined,
      currentUserId: CURRENT_USER_ID,
      favorites: [favorite('page', page.id, 'public')],
      folders: [],
      pages: [page],
      workspaceAdminOwnerIds: new Set(),
    });

    expect(item?.shareSource).toBe('public');
  });
});
