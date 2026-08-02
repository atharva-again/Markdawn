import { z } from 'zod';
import { vaultImportRequestSchema } from '../../utils/vaultImportValidation';
import {
  binaryResponseSchema,
  jsonContent,
  markdownContent,
  multipartContent,
  uuidPathParameter,
  type V1OperationContract,
  zipContent,
} from './apiContract';
import { lifecyclePaths } from './lifecyclePaths';

const uuid = z.uuid();
export const parentRequestSchema = z.object({ parentId: uuid.nullable() }).strict();
export const markdownImportRequestSchema = z
  .object({ file: z.file({ error: 'File is required' }) })
  .strict();
export const lifecycleEntityResponseSchema = z.object({ id: uuid }).strict();
export const lifecycleDeletedResponseSchema = z.object({ deleted: z.literal(true) }).strict();
export const lifecyclePurgeResponseSchema = lifecycleDeletedResponseSchema
  .extend({
    folders: z.number().int().nonnegative(),
    pages: z.number().int().nonnegative(),
  })
  .strict();
export const lifecycleFolderCopyResponseSchema = lifecycleEntityResponseSchema
  .extend({
    skippedRestrictedItems: z.boolean(),
  })
  .strict();
export const lifecyclePageTrashItemSchema = z
  .object({
    id: uuid,
    title: z.string(),
    icon: z.string().nullable(),
    deletedAt: z.string().nullable(),
  })
  .strict();
export const lifecycleFolderTrashItemSchema = z
  .object({
    id: uuid,
    name: z.string(),
    icon: z.string().nullable(),
    deletedAt: z.string().nullable(),
  })
  .strict();
export const obsidianImportRequestSchema = vaultImportRequestSchema;
export const lifecycleMarkdownImportResponseSchema = z
  .object({
    page: z.object({ id: uuid, title: z.string() }).strict(),
    warnings: z.array(
      z
        .object({
          code: z.literal('LOCAL_IMAGES_NOT_IMPORTED'),
          count: z.number().int().positive(),
          message: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
export const lifecycleVaultImportResponseSchema = z
  .object({
    foldersCreated: z.number(),
    pagesCreated: z.number(),
    imagesUploaded: z.number(),
    backlinksCreated: z.number(),
    errors: z.array(z.string()),
  })
  .strict();

export type LifecycleEntityResponse = z.infer<typeof lifecycleEntityResponseSchema>;
export type LifecycleDeletedResponse = z.infer<typeof lifecycleDeletedResponseSchema>;
export type LifecyclePurgeResponse = z.infer<typeof lifecyclePurgeResponseSchema>;
export type LifecycleFolderCopyResponse = z.infer<typeof lifecycleFolderCopyResponseSchema>;
export type LifecyclePageTrashItem = z.infer<typeof lifecyclePageTrashItemSchema>;
export type LifecycleFolderTrashItem = z.infer<typeof lifecycleFolderTrashItemSchema>;
export type LifecycleMarkdownImportResponse = z.infer<typeof lifecycleMarkdownImportResponseSchema>;
export type LifecycleVaultImportResponse = z.infer<typeof lifecycleVaultImportResponseSchema>;

export function toLifecycleEntityResponse(value: { id: string }): LifecycleEntityResponse {
  return { id: value.id };
}

export function toLifecycleDeletedResponse(): LifecycleDeletedResponse {
  return { deleted: true };
}

export function toLifecyclePurgeResponse(value: {
  folders: number;
  pages: number;
}): LifecyclePurgeResponse {
  return { deleted: true, folders: value.folders, pages: value.pages };
}

export function toLifecycleFolderCopyResponse(
  value: { id: string },
  skippedRestrictedItems: boolean,
): LifecycleFolderCopyResponse {
  return { id: value.id, skippedRestrictedItems };
}

function toLifecycleTimestamp(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

export function toLifecyclePageTrashItem(value: {
  id: string;
  title: string;
  icon: string | null;
  deletedAt: Date | string | null;
}): LifecyclePageTrashItem {
  return {
    id: value.id,
    title: value.title,
    icon: value.icon,
    deletedAt: toLifecycleTimestamp(value.deletedAt),
  };
}

export function toLifecycleFolderTrashItem(value: {
  id: string;
  name: string;
  icon: string | null;
  deletedAt: Date | string | null;
}): LifecycleFolderTrashItem {
  return {
    id: value.id,
    name: value.name,
    icon: value.icon,
    deletedAt: toLifecycleTimestamp(value.deletedAt),
  };
}

export function toLifecycleMarkdownImportResponse(value: {
  page: { id: string; title: string };
  warnings: Array<{
    code: 'LOCAL_IMAGES_NOT_IMPORTED';
    count: number;
    message: string;
  }>;
}): LifecycleMarkdownImportResponse {
  return {
    page: { id: value.page.id, title: value.page.title },
    warnings: value.warnings.map((warning) => ({
      code: warning.code,
      count: warning.count,
      message: warning.message,
    })),
  };
}

export function toLifecycleVaultImportResponse(value: {
  foldersCreated: number;
  pagesCreated: number;
  imagesUploaded: number;
  backlinksCreated: number;
  errors: string[];
}): LifecycleVaultImportResponse {
  return {
    foldersCreated: value.foldersCreated,
    pagesCreated: value.pagesCreated,
    imagesUploaded: value.imagesUploaded,
    backlinksCreated: value.backlinksCreated,
    errors: value.errors,
  };
}

const pageId = uuidPathParameter('pageId');
const folderId = uuidPathParameter('folderId');

export const lifecycleOperations = [
  {
    method: 'post',
    ...lifecyclePaths.pageCopy,
    summary: 'Copy a page to a folder or the workspace root',
    parameters: [pageId],
    request: { required: true, ...jsonContent(parentRequestSchema) },
    responses: {
      '201': {
        description: 'Copied page',
        content: jsonContent(lifecycleEntityResponseSchema),
      },
    },
  },
  {
    method: 'patch',
    ...lifecyclePaths.pageMove,
    summary: 'Move a page to a folder or the workspace root',
    parameters: [pageId],
    request: { required: true, ...jsonContent(parentRequestSchema) },
    responses: {
      '200': {
        description: 'Moved page',
        content: jsonContent(lifecycleEntityResponseSchema),
      },
    },
  },
  {
    method: 'delete',
    ...lifecyclePaths.pageTrash,
    summary: 'Move a page to Trash',
    parameters: [pageId],
    responses: {
      '200': {
        description: 'Trashed page',
        content: jsonContent(lifecycleDeletedResponseSchema),
      },
    },
  },
  {
    method: 'get',
    ...lifecyclePaths.pageTrashList,
    summary: 'List trashed pages',
    responses: {
      '200': {
        description: 'Trashed pages',
        content: jsonContent(z.array(lifecyclePageTrashItemSchema)),
      },
    },
  },
  {
    method: 'patch',
    ...lifecyclePaths.pageRestore,
    summary: 'Restore a trashed page',
    parameters: [pageId],
    responses: {
      '200': {
        description: 'Restored page',
        content: jsonContent(lifecycleEntityResponseSchema),
      },
    },
  },
  {
    method: 'delete',
    ...lifecyclePaths.pagePermanentDelete,
    summary: 'Permanently delete a trashed page',
    parameters: [pageId],
    responses: {
      '200': {
        description: 'Deleted page',
        content: jsonContent(lifecycleDeletedResponseSchema),
      },
    },
  },
  {
    method: 'get',
    ...lifecyclePaths.pageMarkdownExport,
    summary: 'Export one page as Markdown or a ZIP with attachments',
    parameters: [pageId],
    responses: {
      '200': {
        description: 'Markdown export, or a ZIP containing Markdown and attachments',
        content: [markdownContent(z.string()), zipContent(binaryResponseSchema)],
      },
    },
  },
  {
    method: 'post',
    ...lifecyclePaths.folderCopy,
    summary: 'Copy a folder subtree to a folder or the workspace root',
    parameters: [folderId],
    request: { required: true, ...jsonContent(parentRequestSchema) },
    responses: {
      '201': {
        description: 'Copied folder',
        content: jsonContent(lifecycleFolderCopyResponseSchema),
      },
    },
  },
  {
    method: 'delete',
    ...lifecyclePaths.folderTrash,
    summary: 'Move a folder subtree to Trash',
    parameters: [folderId, { name: 'force', in: 'query', schema: { type: 'boolean' } }],
    responses: {
      '200': {
        description: 'Trashed folder',
        content: jsonContent(lifecycleDeletedResponseSchema),
      },
    },
  },
  {
    method: 'get',
    ...lifecyclePaths.folderTrashList,
    summary: 'List trashed folders',
    responses: {
      '200': {
        description: 'Trashed folders',
        content: jsonContent(z.array(lifecycleFolderTrashItemSchema)),
      },
    },
  },
  {
    method: 'patch',
    ...lifecyclePaths.folderRestore,
    summary: 'Restore a trashed folder subtree',
    parameters: [folderId],
    responses: {
      '200': {
        description: 'Restored folder',
        content: jsonContent(lifecycleEntityResponseSchema),
      },
    },
  },
  {
    method: 'delete',
    ...lifecyclePaths.folderPermanentDelete,
    summary: 'Permanently delete a trashed folder subtree',
    parameters: [folderId],
    responses: {
      '200': {
        description: 'Deleted folder',
        content: jsonContent(lifecyclePurgeResponseSchema),
      },
    },
  },
  {
    method: 'delete',
    ...lifecyclePaths.trashEmpty,
    summary: 'Permanently delete all eligible Trash items',
    responses: {
      '200': {
        description: 'Emptied Trash',
        content: jsonContent(lifecyclePurgeResponseSchema),
      },
    },
  },
  {
    method: 'post',
    ...lifecyclePaths.markdownImport,
    summary: 'Import one Markdown page at the workspace root',
    request: { required: true, ...multipartContent(markdownImportRequestSchema) },
    responses: {
      '201': {
        description: 'Imported page',
        content: jsonContent(lifecycleMarkdownImportResponseSchema),
      },
    },
  },
  {
    method: 'post',
    ...lifecyclePaths.obsidianImport,
    summary: 'Import an Obsidian vault folder at the workspace root',
    request: {
      required: true,
      ...jsonContent(obsidianImportRequestSchema),
    },
    responses: {
      '201': {
        description: 'Import result',
        content: jsonContent(lifecycleVaultImportResponseSchema),
      },
    },
  },
  {
    method: 'get',
    ...lifecyclePaths.workspaceExport,
    summary: 'Export all accessible pages as a ZIP',
    responses: { '200': { description: 'ZIP export', content: zipContent(binaryResponseSchema) } },
  },
] as const satisfies readonly V1OperationContract[];
