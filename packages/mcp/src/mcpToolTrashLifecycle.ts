import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  destructiveAnnotations,
  MCP_MAX_BATCH_REFERENCES,
  readAnnotations,
  registerTool,
  writeAnnotations,
} from './mcpToolRegistration';
import {
  type McpTrashLifecycleBackend,
  mcpEmptiedSchema,
  mcpLifecycleBatchSchema,
  mcpTrashListSchema,
} from './types';

export function registerTrashLifecycleTools(
  server: McpServer,
  backend: McpTrashLifecycleBackend,
  canWrite: boolean,
): void {
  registerTool(
    server,
    'list_trash',
    'Use this when you need to inspect pages and folders currently in Trash.',
    {},
    readAnnotations,
    mcpTrashListSchema,
    (_input, options) => backend.listTrashed(options),
  );

  if (!canWrite) return;

  registerTool(
    server,
    'move_pages',
    'Use this when the user asks to move one or more pages to a folder or the top level.',
    {
      references: z.array(z.string().min(1)).min(1).max(MCP_MAX_BATCH_REFERENCES),
      parentId: z.string().uuid().nullable(),
    },
    writeAnnotations,
    mcpLifecycleBatchSchema,
    (input, options) => backend.movePages(input.references, input.parentId, options),
  );
  registerTool(
    server,
    'copy_pages',
    'Use this when the user asks to copy one or more pages to a folder or the top level. Provide a stable idempotencyKey so a retry cannot create duplicates.',
    {
      references: z.array(z.string().min(1)).min(1).max(MCP_MAX_BATCH_REFERENCES),
      parentId: z.string().uuid().nullable(),
      idempotencyKey: z.string().min(1).max(200),
    },
    writeAnnotations,
    mcpLifecycleBatchSchema,
    (input, options) =>
      backend.copyPages(input.references, input.parentId, input.idempotencyKey, options),
  );
  registerTool(
    server,
    'trash_pages',
    'Use this when the user asks to move one or more pages to Trash. The client should confirm this change with the user.',
    { references: z.array(z.string().min(1)).min(1).max(MCP_MAX_BATCH_REFERENCES) },
    destructiveAnnotations,
    mcpLifecycleBatchSchema,
    (input, options) => backend.trashPages(input.references, options),
  );
  registerTool(
    server,
    'move_folders',
    'Use this when the user asks to move one or more folders to another folder or the top level.',
    {
      references: z.array(z.string().min(1)).min(1).max(MCP_MAX_BATCH_REFERENCES),
      parentId: z.string().uuid().nullable(),
    },
    writeAnnotations,
    mcpLifecycleBatchSchema,
    (input, options) => backend.moveFolders(input.references, input.parentId, options),
  );
  registerTool(
    server,
    'copy_folders',
    'Use this when the user asks to copy one or more folder subtrees. Each item is processed as an independent REST operation; inspect every result when copying related folders. Provide a stable idempotencyKey so a retry cannot create duplicates.',
    {
      references: z.array(z.string().min(1)).min(1).max(MCP_MAX_BATCH_REFERENCES),
      parentId: z.string().uuid().nullable(),
      idempotencyKey: z.string().min(1).max(200),
    },
    writeAnnotations,
    mcpLifecycleBatchSchema,
    (input, options) =>
      backend.copyFolders(input.references, input.parentId, input.idempotencyKey, options),
  );
  registerTool(
    server,
    'trash_folders',
    'Use this when the user asks to move one or more folders and their contents to Trash. The client should confirm this change with the user.',
    { references: z.array(z.string().min(1)).min(1).max(MCP_MAX_BATCH_REFERENCES) },
    destructiveAnnotations,
    mcpLifecycleBatchSchema,
    (input, options) => backend.trashFolders(input.references, true, options),
  );
  registerTool(
    server,
    'restore_trash',
    'Use this when the user asks to restore trashed pages or folders.',
    {
      type: z.enum(['page', 'folder']),
      references: z.array(z.string().min(1)).min(1).max(MCP_MAX_BATCH_REFERENCES),
    },
    writeAnnotations,
    mcpLifecycleBatchSchema,
    (input, options) => backend.restoreTrash(input.type, input.references, options),
  );
  registerTool(
    server,
    'delete_trash',
    'Use this when the user asks to permanently delete trashed pages or folders. The client should confirm this irreversible change with the user.',
    {
      type: z.enum(['page', 'folder']),
      references: z.array(z.string().min(1)).min(1).max(MCP_MAX_BATCH_REFERENCES),
    },
    destructiveAnnotations,
    mcpLifecycleBatchSchema,
    (input, options) => backend.deleteTrash(input.type, input.references, options),
  );
  registerTool(
    server,
    'empty_trash',
    'Use this when the user asks to permanently delete all eligible Trash items. The client should confirm this irreversible change with the user.',
    {},
    destructiveAnnotations,
    mcpEmptiedSchema,
    (_input, options) => backend.emptyTrash(options),
  );
}
