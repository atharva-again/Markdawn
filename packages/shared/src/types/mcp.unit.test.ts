import { describe, expect, it } from 'vitest';
import { mcpPageSchema, mcpTrashItemSchema } from './mcp';

const page = {
  id: '11111111-1111-4111-8111-111111111111',
  parentId: null,
  title: 'Page',
  icon: null,
  cover: null,
  properties: null,
  ownerId: '22222222-2222-4222-8222-222222222222',
  permission: 'edit' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('MCP response contracts', () => {
  it('keeps canonical page fields required and UUID-constrained', () => {
    expect(mcpPageSchema.safeParse(page).success).toBe(true);
    expect(mcpPageSchema.safeParse({ ...page, id: 'page-id', createdAt: null }).success).toBe(
      false,
    );
    expect(mcpPageSchema.safeParse({ ...page, cover: undefined }).success).toBe(false);
  });

  it('uses canonical UUIDs for trash entity IDs', () => {
    const item = {
      id: '11111111-1111-4111-8111-111111111111',
      type: 'page' as const,
      title: 'Page',
      icon: null,
      deletedAt: null,
    };

    expect(mcpTrashItemSchema.safeParse(item).success).toBe(true);
    expect(mcpTrashItemSchema.safeParse({ ...item, id: 'page-id' }).success).toBe(false);
  });
});
