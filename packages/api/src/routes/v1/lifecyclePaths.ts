type LifecycleOperationPath = {
  routePath: string;
  openApiPath: string;
};

export const lifecyclePaths = {
  pageCopy: {
    routePath: '/pages/:id/copy',
    openApiPath: '/pages/{pageId}/copy',
  },
  pageMove: {
    routePath: '/pages/:id/move',
    openApiPath: '/pages/{pageId}/move',
  },
  pageTrash: {
    routePath: '/pages/:id/trash',
    openApiPath: '/pages/{pageId}/trash',
  },
  pageTrashList: {
    routePath: '/trash/pages',
    openApiPath: '/trash/pages',
  },
  pageRestore: {
    routePath: '/pages/:id/restore',
    openApiPath: '/pages/{pageId}/restore',
  },
  pagePermanentDelete: {
    routePath: '/pages/:id/permanent',
    openApiPath: '/pages/{pageId}/permanent',
  },
  pageMarkdownExport: {
    routePath: '/pages/:id/export/markdown',
    openApiPath: '/pages/{pageId}/export/markdown',
  },
  folderCopy: {
    routePath: '/folders/:id/copy',
    openApiPath: '/folders/{folderId}/copy',
  },
  folderTrash: {
    routePath: '/folders/:id/trash',
    openApiPath: '/folders/{folderId}/trash',
  },
  folderTrashList: {
    routePath: '/trash/folders',
    openApiPath: '/trash/folders',
  },
  folderRestore: {
    routePath: '/folders/:id/restore',
    openApiPath: '/folders/{folderId}/restore',
  },
  folderPermanentDelete: {
    routePath: '/folders/:id/permanent',
    openApiPath: '/folders/{folderId}/permanent',
  },
  trashEmpty: {
    routePath: '/trash/empty',
    openApiPath: '/trash/empty',
  },
  markdownImport: {
    routePath: '/imports/markdown',
    openApiPath: '/imports/markdown',
  },
  obsidianImport: {
    routePath: '/imports/obsidian',
    openApiPath: '/imports/obsidian',
  },
  workspaceExport: {
    routePath: '/exports/workspace',
    openApiPath: '/exports/workspace',
  },
} as const satisfies Record<string, LifecycleOperationPath>;
