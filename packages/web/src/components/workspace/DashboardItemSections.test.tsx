import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ExplorerItemData } from './ExplorerItem';

type MockExplorerItemProps = {
  isEditing?: boolean;
  item: ExplorerItemData;
  onRename?: () => void;
};

vi.mock('./ExplorerItem', () => ({
  ExplorerItem: ({ item, isEditing = false, onRename }: MockExplorerItemProps) => (
    <button type="button" onClick={onRename}>
      {`${item.title}: ${isEditing ? 'editing' : 'idle'}`}
    </button>
  ),
}));

import { DashboardItemSections, type DashboardSection } from './DashboardItemSections';

const ITEM: ExplorerItemData = {
  id: 'favorite-page',
  type: 'page',
  title: 'Favorite page',
  updatedAt: new Date('2026-01-01'),
  ownerId: 'current-user',
};

type EditingTarget = {
  kind: 'page' | 'folder';
  id: string;
  section: DashboardSection;
  value: string;
} | null;

function RenameHarness() {
  const [editingTarget, setEditingTarget] = useState<EditingTarget>(null);
  return (
    <DashboardItemSections
      allItems={[ITEM]}
      favoriteItems={[ITEM]}
      viewMode="list"
      currentUserId="current-user"
      canSelect
      hasSelection={false}
      isEditingAllowed
      editingTarget={editingTarget}
      isFavorite={() => true}
      isSelected={() => false}
      onSelect={() => {}}
      onNavigate={() => {}}
      onRename={(item, section) =>
        setEditingTarget({ kind: item.type, id: item.id, section, value: item.title })
      }
      onEditChange={() => {}}
      onEditKeyDown={() => {}}
      onEditSave={() => {}}
    />
  );
}

describe('DashboardItemSections', () => {
  it('edits only the selected section when a favorite also appears in all items', async () => {
    const user = userEvent.setup();
    render(<RenameHarness />);

    const favoriteRename = screen.getAllByRole('button', { name: 'Favorite page: idle' }).at(0);
    if (!favoriteRename) throw new Error('Favorite rename action was not rendered');
    await user.click(favoriteRename);

    expect(screen.getAllByRole('button', { name: 'Favorite page: editing' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Favorite page: idle' })).toHaveLength(1);
  });
});
