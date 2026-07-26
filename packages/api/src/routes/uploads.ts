import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { auth } from '../auth';
import { db } from '../db/connection';
import { executeQuery, type QueryExecutor } from '../db/query';
import { uploadsDir } from '../env';
import {
  actorColumns,
  ensureActorPageAccess,
  getRequestActor,
  persistGuestIdentity,
} from '../utils/guestAccess';
import {
  hasValidImageSignature,
  IMAGE_EXTENSION_BY_MIME,
  isSafeImageMime,
  MAX_IMAGE_SIZE_BYTES,
} from '../utils/image-upload';
import { lockEntityAccess, lockWorkspaceAccess } from '../utils/share-access';

const uploadsRoute = new Hono();
const MAX_UPLOAD_REQUEST_BYTES = MAX_IMAGE_SIZE_BYTES + 256 * 1024;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type UploadRow = {
  id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  size: number;
  uploaded_by: string | null;
  uploaded_by_guest_id: string | null;
};

const getUploadByFilename = async (filename: string, executor: QueryExecutor = db) => {
  const result = await executeQuery<UploadRow>(
    executor,
    sql`select * from uploads where filename = ${filename} limit 1`,
  );
  return result.rows[0] ?? null;
};

type UploadAccess = {
  has_references: boolean;
  has_accessible_reference: boolean;
};

const getUploadAccess = async (
  executor: QueryExecutor,
  uploadId: string,
  userId: string,
): Promise<UploadAccess> => {
  const result = await executeQuery<UploadAccess>(
    executor,
    sql`SELECT
       EXISTS (
         SELECT 1
         FROM upload_page_refs
         WHERE upload_id = ${uploadId}
       ) AS has_references,
       EXISTS (
         SELECT 1
         FROM upload_page_refs upr
         JOIN LATERAL get_effective_page_permission(upr.page_id, ${userId}) access ON true
         WHERE upr.upload_id = ${uploadId}
           AND access.permission IS NOT NULL
       ) AS has_accessible_reference`,
  );
  const access = result.rows[0];
  if (!access) {
    return { has_references: false, has_accessible_reference: false };
  }
  return access;
};

const isUploadPublic = async (executor: QueryExecutor, uploadId: string): Promise<boolean> => {
  const result = await executeQuery(
    executor,
    sql`SELECT 1
     FROM upload_page_refs reference
     JOIN pages page ON page.id = reference.page_id AND page.is_deleted = false
     WHERE reference.upload_id = ${uploadId}
       AND get_public_page_permission(page.id) IS NOT NULL
     LIMIT 1`,
  );
  return (result.rowCount ?? 0) > 0;
};

const getUploadWorkspaceOwnerIds = async (
  executor: QueryExecutor,
  uploadId: string,
): Promise<string[]> => {
  const result = await executeQuery<{ owner_id: string }>(
    executor,
    sql`SELECT DISTINCT COALESCE(get_root_folder_owner(p.parent_id), p.created_by) AS owner_id
     FROM upload_page_refs upr
     JOIN pages p ON p.id = upr.page_id
     WHERE upr.upload_id = ${uploadId}
     ORDER BY owner_id`,
  );
  return result.rows.map((row) => row.owner_id);
};

uploadsRoute.post(
  '/',
  bodyLimit({
    maxSize: MAX_UPLOAD_REQUEST_BYTES,
    onError: (c) => c.json({ message: 'Request body is too large' }, 413),
  }),
  async (c) => {
    const actor = await getRequestActor(c);
    if (actor.kind === 'guest') {
      throw new HTTPException(403, { message: 'Guest editors cannot upload files' });
    }
    const body = await c.req.parseBody().catch((error: unknown) => {
      if (error instanceof Error && error.name === 'BodyLimitError') throw error;
      return null;
    });
    if (!body || typeof body !== 'object') {
      throw new HTTPException(400, { message: 'Invalid form data' });
    }

    const file = (body as Record<string, unknown>).file;
    const pageId = (body as Record<string, unknown>).pageId;

    if (typeof pageId !== 'string' || !UUID_PATTERN.test(pageId)) {
      throw new HTTPException(400, { message: 'Page ID is required' });
    }

    await ensureActorPageAccess(actor, pageId, 'edit');

    if (!(file instanceof File)) {
      throw new HTTPException(400, { message: 'File is required' });
    }

    if (!isSafeImageMime(file.type)) {
      throw new HTTPException(400, { message: 'Only JPEG, PNG, GIF, and WebP images are allowed' });
    }

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      throw new HTTPException(400, { message: 'File must be 10MB or less' });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!hasValidImageSignature(buffer, file.type)) {
      throw new HTTPException(400, {
        message: 'File contents do not match the selected image type',
      });
    }

    await mkdir(uploadsDir, { recursive: true });

    const extension = IMAGE_EXTENSION_BY_MIME.get(file.type);
    if (!extension) {
      throw new HTTPException(400, { message: 'Unsupported image type' });
    }
    const filename = `${randomUUID()}.${extension}`;
    const filePath = path.join(uploadsDir, filename);
    await writeFile(filePath, buffer);

    try {
      await db.transaction(async (tx) => {
        await lockEntityAccess(tx, 'page', pageId);
        await ensureActorPageAccess(actor, pageId, 'edit', tx);
        await persistGuestIdentity(actor, tx);
        const uploader = actorColumns(actor);
        const uploadResult = await executeQuery<{ id: string }>(
          tx,
          sql`insert into uploads
           (filename, original_name, mime_type, size, uploaded_by, uploaded_by_guest_id)
         values (${filename}, ${file.name}, ${file.type}, ${file.size}, ${uploader.userId}, ${uploader.guestId})
         returning id`,
        );
        const uploadId = uploadResult.rows[0]?.id;
        if (!uploadId) {
          throw new HTTPException(500, { message: 'Failed to create upload' });
        }

        await executeQuery(
          tx,
          sql`insert into upload_page_refs (upload_id, page_id)
         values (${uploadId}, ${pageId})
         on conflict (upload_id, page_id) do nothing`,
        );
      });
    } catch (error) {
      try {
        await unlink(filePath);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Upload failed and file cleanup was unsuccessful',
        );
      }
      throw error;
    }

    return c.json({ url: `/api/uploads/${filename}` });
  },
);

uploadsRoute.get('/:filename', async (c) => {
  const filename = c.req.param('filename');

  // Validate filename - only allow alphanumeric, dash, underscore, dot
  if (!/^[a-zA-Z0-9\-_.]+$/.test(filename)) {
    throw new HTTPException(400, { message: 'Invalid filename' });
  }

  c.header('Cache-Control', 'no-store');
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const user = session?.user as { id: string } | undefined;

  const materialized = await db.transaction(async (tx) => {
    const candidateUpload = await getUploadByFilename(filename, tx);
    if (!candidateUpload) {
      throw new HTTPException(404, { message: 'Not found' });
    }

    // Every operation that can change an upload's referenced pages or their
    // access state takes the corresponding workspace lock. Hold all current
    // owners in stable order, then re-read the reference set before checking
    // access so a revoke, public-access change, move, copy, or purge cannot linearize
    // between authorization and byte materialization.
    const ownerIds = await getUploadWorkspaceOwnerIds(tx, candidateUpload.id);
    for (const ownerId of ownerIds) {
      await lockWorkspaceAccess(tx, ownerId);
    }
    const currentOwnerIds = await getUploadWorkspaceOwnerIds(tx, candidateUpload.id);
    const lockedOwnerIds = new Set(ownerIds);
    if (currentOwnerIds.some((ownerId) => !lockedOwnerIds.has(ownerId))) {
      throw new HTTPException(409, {
        message: 'Upload references changed while acquiring access lock; retry the request',
      });
    }

    const upload = await getUploadByFilename(filename, tx);
    if (!upload) {
      throw new HTTPException(404, { message: 'Not found' });
    }

    let cacheControl = 'private, no-store';
    if (user) {
      const access = await getUploadAccess(tx, upload.id, user.id);
      const canUseOrphanFallback = upload.uploaded_by === user.id && !access.has_references;
      if (!access.has_accessible_reference && !canUseOrphanFallback) {
        throw new HTTPException(403, { message: "You don't have access to this file" });
      }
    } else if (await isUploadPublic(tx, upload.id)) {
      cacheControl = 'public, max-age=0, must-revalidate';
    } else {
      throw new HTTPException(404, { message: 'Not found' });
    }

    try {
      const fileBuffer = await readFile(path.join(uploadsDir, filename));
      return { upload, fileBuffer, cacheControl };
    } catch {
      throw new HTTPException(404, { message: 'File not found' });
    }
  });

  c.header('Cache-Control', materialized.cacheControl);
  return c.body(materialized.fileBuffer, 200, {
    'Content-Type': materialized.upload.mime_type,
    'Content-Length': materialized.upload.size.toString(),
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
});

export default uploadsRoute;
