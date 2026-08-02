import { describe, expect, it } from 'vitest';
import { toFolderResponse, updateFolderRequestSchema } from './folders';

describe('v1 folder request contracts', () => {
  it('requires a supported update field', () => {
    const result = updateFolderRequestSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('No supported fields were provided');
    }
  });

  it('accepts a name, a parent ID, or both', () => {
    const parentId = '5d418de1-6b6f-4bb3-a35c-bc0c134b48dd';
    expect(updateFolderRequestSchema.safeParse({ name: 'Renamed' }).success).toBe(true);
    expect(updateFolderRequestSchema.safeParse({ parentId }).success).toBe(true);
    expect(updateFolderRequestSchema.safeParse({ name: 'Renamed', parentId }).success).toBe(true);
  });

  it('serializes valid permissions and timestamps consistently', () => {
    const id = '5d418de1-6b6f-4bb3-a35c-bc0c134b48dd';
    const response = toFolderResponse({
      id,
      parentId: null,
      name: 'Folder',
      icon: null,
      ownerId: id,
      permission: 'not-a-permission',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: null,
    });

    expect(response).toEqual({
      id,
      parentId: null,
      name: 'Folder',
      icon: null,
      ownerId: id,
      permission: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: null,
    });
  });
});
