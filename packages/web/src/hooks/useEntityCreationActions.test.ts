import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFolder, createMockPage } from '../test-utils/factories';

const mocks = vi.hoisted(() => ({
  identityActive: true,
  navigate: vi.fn(),
  createPage: vi.fn(),
  createFolder: vi.fn(),
}));

vi.mock('../contexts/IdentityLifecycleContext', () => ({
  useIdentityLifecycle: () => ({ isActive: () => mocks.identityActive }),
  useIdentityNavigate: () => mocks.navigate,
}));

vi.mock('./use-pages', () => ({
  useCreatePage: () => ({ mutateAsync: mocks.createPage, isPending: false }),
}));

vi.mock('./use-folders', () => ({
  useCreateFolder: () => ({ mutateAsync: mocks.createFolder, isPending: false }),
}));

import { useEntityCreationActions } from './useEntityCreationActions';

describe('useEntityCreationActions', () => {
  beforeEach(() => {
    mocks.identityActive = true;
    mocks.navigate.mockReset();
    mocks.createPage.mockReset();
    mocks.createFolder.mockReset();
  });

  it('creates a page and applies the shared navigation behavior', async () => {
    const page = createMockPage({ id: 'page-1', title: 'Created page' });
    mocks.createPage.mockResolvedValue(page);
    const { result } = renderHook(() => useEntityCreationActions());

    let created: typeof page | undefined;
    await act(async () => {
      created = await result.current.createPageAndNavigate({ parentId: 'folder-1' });
    });

    expect(mocks.createPage).toHaveBeenCalledWith({ parentId: 'folder-1' });
    expect(mocks.navigate).toHaveBeenCalledWith('/created-page-page-1');
    expect(created).toBe(page);
  });

  it('returns a confirmed folder for view-specific editing behavior', async () => {
    const folder = createMockFolder({ id: 'folder-1', name: 'Created folder' });
    mocks.createFolder.mockResolvedValue(folder);
    const { result } = renderHook(() => useEntityCreationActions());

    let created: typeof folder | undefined;
    await act(async () => {
      created = await result.current.createFolder();
    });

    expect(created).toBe(folder);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('does not navigate after the active identity retires', async () => {
    mocks.createPage.mockImplementation(async () => {
      mocks.identityActive = false;
      return createMockPage({ id: 'page-1' });
    });
    const { result } = renderHook(() => useEntityCreationActions());

    await act(async () => {
      expect(await result.current.createPageAndNavigate()).toBeUndefined();
    });

    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('propagates page creation failures without navigating', async () => {
    const error = new Error('Page creation failed');
    mocks.createPage.mockRejectedValue(error);
    const { result } = renderHook(() => useEntityCreationActions());

    await expect(result.current.createPageAndNavigate()).rejects.toBe(error);

    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('propagates folder creation failures', async () => {
    const error = new Error('Folder creation failed');
    mocks.createFolder.mockRejectedValue(error);
    const { result } = renderHook(() => useEntityCreationActions());

    await expect(result.current.createFolder()).rejects.toBe(error);
  });
});
