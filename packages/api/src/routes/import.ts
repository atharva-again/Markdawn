import {
  type MarkdownImportResult,
  type MarkdownImportWarning,
  parseMarkdownFrontmatter,
  UnsupportedMarkdownFrontmatterError,
} from '@markdawn/shared';
import { bindWikiLinkTargets, createYjsDocWithTitle } from '@markdawn/shared/markdown-yjs';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/connection';
import { executeQuery } from '../db/query';
import { requireAuth } from '../middleware/auth';
import { getDestinationOwnerId } from '../utils/destinationOwner';
import { ensureDocumentInputSize, ensureYdocSize } from '../utils/documentSize';
import { replacePageConnectionIndex } from '../utils/pageConnectionIndex';
import type { PageDatabaseRow } from '../utils/pageRows';
import { normalizePageTitle } from '../utils/pageTitle';
import { getNextPosition } from '../utils/position';
import {
  ensureFolderAccess,
  lockEntityAccessMutation,
  lockWorkspaceAccessMutation,
} from '../utils/share-access';
import { notifyShareRecompute } from '../utils/share-notify';
import { getEntityMetaUserIds } from '../utils/shareRecipients';
import { getUniqueWorkspacePageLookup } from '../utils/wiki-link-lookup';

const importRoute = new Hono();

importRoute.use('*', requireAuth);

const isLocalImageReference = (reference: string): boolean => {
  const value = reference.trim();
  return !/^(?:https?:)?\/\//i.test(value) && !/^(?:data|blob):/i.test(value);
};

const countLocalImageReferences = (content: string): number => {
  const references: string[] = [];

  for (const match of content.matchAll(/!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/g)) {
    const reference = match[1] ?? match[2];
    if (reference) references.push(reference);
  }

  for (const match of content.matchAll(
    /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi,
  )) {
    const reference = match[1] ?? match[2] ?? match[3];
    if (reference) references.push(reference);
  }

  for (const match of content.matchAll(
    /!\[\[([^\]|#]+\.(?:avif|bmp|gif|jpe?g|png|svg|tiff?|webp))(?:[|#][^\]]*)?\]\]/gi,
  )) {
    const reference = match[1];
    if (reference) references.push(reference);
  }

  return references.filter(isLocalImageReference).length;
};

importRoute.post('/markdown', async (c) => {
  const parentId = c.req.query('parentId') || null;

  const user = c.get('user') as { id: string };

  if (parentId) {
    await ensureFolderAccess(parentId, user.id, 'admin');
  }

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    throw new HTTPException(400, { message: 'File is required' });
  }
  const file = formData.get('file');

  if (!(file instanceof File)) {
    throw new HTTPException(400, { message: 'File is required' });
  }

  if (!file.name.endsWith('.md')) {
    throw new HTTPException(400, { message: 'File must be a markdown file' });
  }

  ensureDocumentInputSize(file);
  const content = await file.text();

  let parsedMarkdown: ReturnType<typeof parseMarkdownFrontmatter>;
  try {
    parsedMarkdown = parseMarkdownFrontmatter(content);
  } catch (error) {
    if (error instanceof UnsupportedMarkdownFrontmatterError) {
      throw new HTTPException(400, { message: error.message });
    }
    throw error;
  }
  const { body, frontmatter: properties } = parsedMarkdown;
  const title = normalizePageTitle(file.name.replace(/\.md$/i, ''));

  const localImageCount = countLocalImageReferences(body);
  const unresolvedYdocBuffer = Buffer.from(createYjsDocWithTitle(title, body));
  ensureYdocSize(unresolvedYdocBuffer);

  const hasProperties = Object.keys(properties).length > 0;
  const insertResult = await db.transaction(async (tx) => {
    if (parentId) {
      await lockEntityAccessMutation(tx, 'folder', parentId);
      await ensureFolderAccess(parentId, user.id, 'admin', tx);
    } else {
      await lockWorkspaceAccessMutation(tx, user.id);
    }

    const ownerId = await getDestinationOwnerId(tx, parentId, user.id);
    if (!ownerId) throw new HTTPException(404, { message: 'Parent folder not found' });
    const pageLookup = await getUniqueWorkspacePageLookup(ownerId, user.id, tx);
    const ydocBuffer = Buffer.from(bindWikiLinkTargets(unresolvedYdocBuffer, pageLookup));
    ensureYdocSize(ydocBuffer);

    const nextPosition = await getNextPosition('pages', parentId, user.id, tx);
    const result = hasProperties
      ? await executeQuery<PageDatabaseRow>(
          tx,
          sql`insert into pages (parent_id, title, title_search, position, created_by, ydoc, properties) values (${parentId}, ${title}, to_tsvector('english', ${title}), ${nextPosition}, ${user.id}, ${ydocBuffer}, ${JSON.stringify(properties)}) returning *`,
        )
      : await executeQuery<PageDatabaseRow>(
          tx,
          sql`insert into pages (parent_id, title, title_search, position, created_by, ydoc) values (${parentId}, ${title}, to_tsvector('english', ${title}), ${nextPosition}, ${user.id}, ${ydocBuffer}) returning *`,
        );
    const createdPageId = result.rows[0]?.id;
    if (createdPageId) {
      await replacePageConnectionIndex(tx, createdPageId, ydocBuffer, properties);
      const metaUserIds = await getEntityMetaUserIds(tx, 'page', createdPageId);
      await notifyShareRecompute(
        {
          entityType: 'page',
          entityId: createdPageId,
          metaUserIds,
          metaOnly: true,
        },
        tx,
      );
    }
    return result;
  });

  if (insertResult.rowCount === 0) {
    throw new HTTPException(500, { message: 'Failed to create page' });
  }

  const createdRow = insertResult.rows[0];
  if (!createdRow) throw new HTTPException(500, { message: 'Failed to create page' });
  const warnings: MarkdownImportWarning[] = [];
  if (localImageCount > 0) {
    warnings.push({
      code: 'LOCAL_IMAGES_NOT_IMPORTED',
      count: localImageCount,
      message: `${localImageCount} local image${localImageCount === 1 ? ' was' : 's were'} not included. Import the folder as an Obsidian vault to include attachments.`,
    });
  }
  const response = {
    page: { id: createdRow.id, title: createdRow.title },
    warnings,
  } satisfies MarkdownImportResult;
  return c.json(response, 201);
});

export default importRoute;
