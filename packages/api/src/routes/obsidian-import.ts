import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  aggregateIndexedPageConnections,
  extractInlineTags,
  extractPropertyTagConnections,
  normalizeWikiLinkLookupKey,
} from '@markdawn/shared';
import { bindWikiLinkTargets, markdownToYjsState } from '@markdawn/shared/markdown-yjs';
import { type ConnectionDraft, normalizeTagSlug } from '@markdawn/shared/yjs-helpers';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/connection';
import { executeQuery, query } from '../db/query';
import { uploadsDir } from '../env';
import { requireAuth } from '../middleware/auth';
import { ensureDocumentInputSize, ensureYdocSize } from '../utils/documentSize';
import { normalizeFolderName } from '../utils/folderName';
import {
  hasValidImageSignature,
  MAX_IMAGE_SIZE_BYTES,
  safeImageMimeForExtension,
} from '../utils/image-upload';
import {
  getExtension,
  isImageFile,
  isMarkdownFile,
  parseFrontmatter,
} from '../utils/obsidian-parsers';
import { replacePageConnectionIndex, replacePageConnections } from '../utils/pageConnectionIndex';
import { normalizePageTitle } from '../utils/pageTitle';
import { getNextPosition } from '../utils/position';
import { lockWorkspaceAccess, lockWorkspaceAccessMutation } from '../utils/share-access';
import { notifyShareRecompute } from '../utils/share-notify';
import { getEntityMetaUserIds } from '../utils/shareRecipients';
import { getUniqueWorkspacePageLookup } from '../utils/wiki-link-lookup';

const obsidianImportRoute = new Hono();
obsidianImportRoute.use('*', requireAuth);

// ── Types ───────────────────────────────────────────────────────────

type VaultFile = {
  path: string;
  content?: string;
  data?: string;
  mimeType?: string;
};

type ImportResult = {
  foldersCreated: number;
  pagesCreated: number;
  imagesUploaded: number;
  backlinksCreated: number;
  errors: string[];
};

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Extract wiki links from markdown content.
 */
const WIKILINK_REGEX = /(?<!!)\[\[([^#|\]]+)(?:#(\^[^|]+)|#([^|\]]+))?(?:\|([^\]]+))?\]\]/g;

interface WikilinkMatch {
  page: string;
  blockId: string | undefined;
  heading: string | undefined;
  alias: string | undefined;
  isEmbed: boolean;
}

const extractWikilinks = (content: string): WikilinkMatch[] => {
  const results: WikilinkMatch[] = [];
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec pattern
  while ((match = WIKILINK_REGEX.exec(content)) !== null) {
    const page = match[1];
    if (!page) continue;
    results.push({
      page: page.trim(),
      blockId: match[2]?.trim(),
      heading: match[3]?.trim(),
      alias: match[4]?.trim(),
      isEmbed: false,
    });
  }
  return results;
};

const extractEmbedLinks = (content: string): WikilinkMatch[] => {
  const embedRegex = /!\[\[([^#|\]]+)(?:#(\^[^|]+)|#([^|\]]+))?(?:\|([^\]]+))?\]\]/g;
  const results: WikilinkMatch[] = [];
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec pattern
  while ((match = embedRegex.exec(content)) !== null) {
    const page = match[1];
    if (!page) continue;
    results.push({
      page: page.trim(),
      blockId: match[2]?.trim(),
      heading: match[3]?.trim(),
      alias: match[4]?.trim(),
      isEmbed: true,
    });
  }
  return results;
};

const processMarkdownContent = (content: string, imageMap: Map<string, string>): string => {
  let result = content;

  result = result.replace(
    /!\[\[([^\]|]+(?:\.jpe?g|\.png|\.gif|\.webp|\.svg))(?:\|([^\]]+))?\]\]/gi,
    (_match, imagePath: string) => {
      const normalizedPath = imagePath.replace(/\\/g, '/').trim();
      const uploadedUrl = imageMap.get(normalizedPath);
      if (uploadedUrl) {
        return `![${path.basename(normalizedPath)}](${uploadedUrl})`;
      }
      return `![${path.basename(normalizedPath)}](${normalizedPath})`;
    },
  );

  result = result.replace(/!\[\[([^\]]+)\]\]/g, (_match, filePath: string) => {
    const normalized = filePath.replace(/\\/g, '/').trim();
    return `[${path.basename(normalized)}](${normalized})`;
  });

  return result;
};

// ── Route Handler ───────────────────────────────────────────────────

obsidianImportRoute.post('/', async (c) => {
  const user = c.get('user') as { id: string };

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    throw new HTTPException(400, { message: 'Invalid body' });
  }

  const { files } = body as { files?: VaultFile[] };
  if (!Array.isArray(files) || files.length === 0) {
    throw new HTTPException(400, { message: 'files array is required' });
  }

  const result: ImportResult = {
    foldersCreated: 0,
    pagesCreated: 0,
    imagesUploaded: 0,
    backlinksCreated: 0,
    errors: [],
  };

  const markdownFiles: VaultFile[] = [];
  const imageFiles: VaultFile[] = [];

  for (const file of files) {
    const fileName = path.basename(file.path);
    if (isMarkdownFile(fileName)) {
      markdownFiles.push(file);
    } else if (isImageFile(fileName) && file.data) {
      const extension = getExtension(fileName);
      const expectedMime = safeImageMimeForExtension(extension);
      if (!expectedMime || file.mimeType !== expectedMime) {
        result.errors.push(
          `Skipped unsupported image "${file.path}". Only JPEG, PNG, GIF, and WebP are allowed.`,
        );
        continue;
      }
      imageFiles.push(file);
    }
  }

  const folderPathToId = new Map<string, string>();
  let notificationRoot: { entityType: 'folder' | 'page'; entityId: string } | null = null;
  const uniqueDirs = new Set<string>();

  for (const file of files) {
    const dir = path.dirname(file.path);
    if (dir !== '.' && dir !== '/') {
      const parts = dir.split(/[\\/]/).filter(Boolean);
      let currentPath = '';
      for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        uniqueDirs.add(currentPath);
      }
    }
  }

  const sortedDirs = Array.from(uniqueDirs).sort((a, b) => {
    const depthA = a.split('/').length;
    const depthB = b.split('/').length;
    return depthA - depthB;
  });

  for (const dirPath of sortedDirs) {
    try {
      const parts = dirPath.split('/');
      const name = normalizeFolderName(parts[parts.length - 1] ?? '');
      const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : null;
      const parentId = parentPath ? (folderPathToId.get(parentPath) ?? null) : null;
      if (parentPath && !parentId) {
        throw new Error(`Parent folder "${parentPath}" was not created`);
      }

      const insertResult = await db.transaction(async (tx) => {
        await lockWorkspaceAccessMutation(tx, user.id);
        const nextPosition = await getNextPosition('folders', parentId, user.id, tx);
        return executeQuery(
          tx,
          sql`insert into folders (parent_id, name, position, created_by) values (${parentId}, ${name}, ${nextPosition}, ${user.id}) returning id`,
        );
      });

      if (insertResult.rowCount && insertResult.rowCount > 0) {
        const createdFolderId = insertResult.rows[0]?.id;
        if (typeof createdFolderId !== 'string') {
          throw new Error('Failed to create folder');
        }
        folderPathToId.set(dirPath, createdFolderId);
        notificationRoot ??= { entityType: 'folder', entityId: createdFolderId };
        result.foldersCreated++;
      }
    } catch (err) {
      result.errors.push(`Failed to create folder "${dirPath}": ${(err as Error).message}`);
    }
  }

  const imagePathToUrl = new Map<string, string>();
  const urlToUploadId = new Map<string, string>();
  await mkdir(uploadsDir, { recursive: true });

  for (const file of imageFiles) {
    try {
      if (!file.data || !file.mimeType) continue;

      const ext = getExtension(file.path);
      const expectedMime = safeImageMimeForExtension(ext);
      if (!expectedMime || file.mimeType !== expectedMime) {
        throw new Error('Unsupported image type');
      }

      const buffer = Buffer.from(file.data, 'base64');
      if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
        throw new Error('Image must be 10MB or less');
      }
      if (!hasValidImageSignature(buffer, expectedMime)) {
        throw new Error('File contents do not match the image type');
      }

      const filename = `${randomUUID()}.${ext === 'jpeg' ? 'jpg' : ext}`;
      const filePath = path.join(uploadsDir, filename);
      await writeFile(filePath, buffer);

      const uploadResult = await query<{ id: string }>(
        sql`insert into uploads (filename, original_name, mime_type, size, uploaded_by)
         values (${filename}, ${path.basename(file.path)}, ${expectedMime}, ${buffer.length}, ${user.id})
         returning id`,
      );
      const uploadId = uploadResult.rows[0]?.id;
      if (!uploadId) {
        throw new Error('Failed to create upload');
      }

      const url = `/api/uploads/${filename}`;
      urlToUploadId.set(url, uploadId);
      imagePathToUrl.set(file.path, url);
      imagePathToUrl.set(path.basename(file.path), url);
      const parts = file.path.split('/');
      if (parts.length > 2) {
        const withoutRoot = parts.slice(1).join('/');
        imagePathToUrl.set(withoutRoot, url);
      }
      result.imagesUploaded++;
    } catch (err) {
      result.errors.push(`Failed to upload image "${file.path}": ${(err as Error).message}`);
    }
  }

  const pagePathToId = new Map<string, string>();
  const pageYdocs = new Map<string, Buffer>();

  for (const file of markdownFiles) {
    try {
      if (!file.content) continue;
      ensureDocumentInputSize(file.content);

      const { frontmatter, body } = parseFrontmatter(file.content);
      const fileName = path.basename(file.path, '.md');
      const title = normalizePageTitle(fileName);

      const dir = path.dirname(file.path);
      const normalizedDir = dir.replace(/\\/g, '/');
      const hasParentDirectory = dir !== '.' && dir !== '/';
      const parentId = hasParentDirectory ? (folderPathToId.get(normalizedDir) ?? null) : null;
      if (hasParentDirectory && !parentId) {
        throw new Error(`Parent folder "${normalizedDir}" was not created`);
      }

      const processedBody = processMarkdownContent(body, imagePathToUrl);
      const ydocBuffer = Buffer.from(markdownToYjsState(processedBody));
      ensureYdocSize(ydocBuffer);
      const pageId = await db.transaction(async (tx) => {
        await lockWorkspaceAccessMutation(tx, user.id);
        const nextPosition = await getNextPosition('pages', parentId, user.id, tx);
        const insertResult = await executeQuery(
          tx,
          sql`insert into pages (parent_id, title, title_search, position, created_by, ydoc, properties)
           values (${parentId}, ${title}, to_tsvector('english', ${title}), ${nextPosition}, ${user.id}, ${ydocBuffer}, ${JSON.stringify(frontmatter)}) returning *`,
        );
        const insertedPageId = insertResult.rows[0]?.id;
        if (typeof insertedPageId !== 'string') {
          throw new Error('Failed to create page');
        }

        for (const [url, uploadId] of urlToUploadId) {
          if (!processedBody.includes(url)) continue;
          await executeQuery(
            tx,
            sql`insert into upload_page_refs (upload_id, page_id)
             values (${uploadId}, ${insertedPageId})
             on conflict (upload_id, page_id) do nothing`,
          );
        }

        await replacePageConnectionIndex(tx, insertedPageId, ydocBuffer, frontmatter);

        return insertedPageId;
      });

      // Store only committed pages for deferred DB connection resolution. A failure
      // while creating upload refs rolls the page back instead of returning a
      // partial import that is absent from the result counters.
      pagePathToId.set(file.path, pageId);
      pageYdocs.set(file.path, ydocBuffer);
      notificationRoot ??= { entityType: 'page', entityId: pageId };
      result.pagesCreated++;
    } catch (err) {
      result.errors.push(`Failed to create page "${file.path}": ${(err as Error).message}`);
    }
  }

  // Imported pages become visible before every file in a large vault has been
  // processed. Resolve each committed page under the workspace lock, re-read
  // its current Yjs state with a row lock, and write connections in the same
  // transaction. This preserves any edit that landed after page creation and
  // prevents a late resolver from mutating a page that was moved to Trash.
  for (const file of markdownFiles) {
    const fileContent = file.content;
    if (!fileContent) continue;
    const pageId = pagePathToId.get(file.path);
    const originalYdoc = pageYdocs.get(file.path);
    if (!pageId || !originalYdoc) continue;

    try {
      const backlinksCreated = await db.transaction(async (tx) => {
        await lockWorkspaceAccess(tx, user.id);
        const pageResult = await executeQuery<{
          ydoc: Buffer | null;
          properties: Record<string, unknown> | null;
        }>(
          tx,
          sql`select ydoc, properties
           from pages
           where id = ${pageId} and is_deleted = false
           for update`,
        );
        const storedYdoc = pageResult.rows[0]?.ydoc;
        if (!storedYdoc) {
          throw new Error('Imported page is no longer active');
        }

        const workspacePageLookup = await getUniqueWorkspacePageLookup(user.id, user.id, tx);
        const currentYdoc = Buffer.from(storedYdoc);
        const pageWasEdited = !currentYdoc.equals(originalYdoc);
        let createdBacklinks = 0;

        if (!pageWasEdited) {
          const boundYdoc = Buffer.from(bindWikiLinkTargets(currentYdoc, workspacePageLookup));
          ensureYdocSize(boundYdoc);
          if (!boundYdoc.equals(currentYdoc)) {
            await executeQuery(
              tx,
              sql`update pages set ydoc = ${boundYdoc}, updated_at = now() where id = ${pageId}`,
            );
            await executeQuery(
              tx,
              sql`select pg_notify(${'page_content_replaced'}, ${JSON.stringify({ pageId })})`,
            );
          }
        }

        // Do not index the original markdown after a user has already changed
        // the page. The current Yjs state is preserved and the collaboration
        // indexer remains authoritative for that newer content.
        if (!pageWasEdited) {
          const wikilinks = extractWikilinks(fileContent);
          const embeds = extractEmbedLinks(fileContent);
          const allLinks = [...wikilinks, ...embeds];
          const connectionDrafts: ConnectionDraft[] = [
            ...extractPropertyTagConnections(pageResult.rows[0]?.properties ?? null),
            ...extractInlineTags(fileContent)
              .map(normalizeTagSlug)
              .filter((tag): tag is string => Boolean(tag))
              .map(
                (tag): ConnectionDraft => ({
                  targetType: 'tag',
                  targetSlug: tag,
                  targetLabel: tag,
                  connectionType: 'tag',
                  linkText: tag,
                }),
              ),
            ...allLinks.flatMap((link): ConnectionDraft[] => {
              if (link.isEmbed && isImageFile(link.page)) return [];
              const targetTitleLower = normalizeWikiLinkLookupKey(link.page);
              const targetPageId = workspacePageLookup.get(targetTitleLower);
              if (targetPageId) createdBacklinks += 1;
              return [
                {
                  targetType: 'page',
                  ...(targetPageId ? { targetId: targetPageId } : {}),
                  targetSlug: targetPageId ? `id:${targetPageId}` : targetTitleLower,
                  targetLabel: link.page,
                  connectionType: link.isEmbed ? 'embed' : link.heading ? 'heading' : 'wikilink',
                  linkText: link.alias || link.page,
                  linkContext: link.alias || link.page,
                },
              ];
            }),
          ];
          await replacePageConnections(
            tx,
            pageId,
            aggregateIndexedPageConnections(connectionDrafts),
          );
        }

        return createdBacklinks;
      });
      result.backlinksCreated += backlinksCreated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`Failed to resolve links for "${file.path}": ${message}`);
    }
  }

  if (notificationRoot) {
    await db.transaction(async (tx) => {
      await lockWorkspaceAccessMutation(tx, user.id);
      const metaUserIds = await getEntityMetaUserIds(
        tx,
        notificationRoot.entityType,
        notificationRoot.entityId,
      );
      await notifyShareRecompute(
        {
          entityType: notificationRoot.entityType,
          entityId: notificationRoot.entityId,
          metaUserIds,
          metaOnly: true,
        },
        tx,
      );
    });
  }

  return c.json(result, 201);
});

export default obsidianImportRoute;
