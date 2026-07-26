import { createHash } from 'node:crypto';
import { normalizeLineEndings } from '@markdawn/shared';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireV1Scope } from '../../middleware/v1Auth';
import { applyPageExactEdits } from '../../utils/collaborationContentClient';
import { releaseIdempotency, reserveIdempotency } from './idempotency';
import { type ExactEditsResponse, exactEditsRequestSchema, pageOperations } from './pageContracts';
import { requireUuid } from './pageModel';
import { v1DocumentJsonBodyLimit } from './requestLimits';
import { parseJsonRequest } from './requestValidation';

type EditResponse = ExactEditsResponse;

export function parseIdempotencyKey(value: string | undefined): string | null {
  if (value === undefined) return null;
  const key = value.trim();
  if (!key) {
    throw new HTTPException(400, {
      message: 'Idempotency-Key must be between 1 and 200 characters',
    });
  }
  return key;
}

export function isUnknownOutcome(error: unknown): boolean {
  if (!(error instanceof HTTPException) || error.status !== 503) return false;
  const cause = error.cause;
  return !(
    cause &&
    typeof cause === 'object' &&
    'code' in cause &&
    cause.code === 'collaboration_busy'
  );
}

const exactEditsRoute = new Hono();

exactEditsRoute.post(
  pageOperations.editContent.routePath,
  requireV1Scope('pages:write'),
  v1DocumentJsonBodyLimit,
  async (c) => {
    const principal = c.get('v1Principal');
    const pageId = requireUuid(c.req.param('id'), 'page ID');
    const idempotencyKey = parseIdempotencyKey(c.req.header('idempotency-key'));
    const request = await parseJsonRequest(c, exactEditsRequestSchema);
    const edits = request.edits.map((edit) => ({
      id: edit.id,
      oldText: normalizeLineEndings(edit.oldText),
      newText: normalizeLineEndings(edit.newText),
    }));
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ pageId, edits }))
      .digest('base64url');
    const reservation = idempotencyKey
      ? await reserveIdempotency<EditResponse>(principal, idempotencyKey, requestHash)
      : null;
    if (reservation?.replay) {
      c.header('ETag', reservation.replay.etag);
      return c.json(reservation.replay);
    }

    try {
      const response = await applyPageExactEdits(pageId, principal, {
        edits,
        ...(idempotencyKey && reservation?.reserved
          ? {
              idempotency: {
                recordId: reservation.recordId,
                key: idempotencyKey,
                requestHash,
              },
            }
          : {}),
      });
      c.header('ETag', response.etag);
      return c.json(response);
    } catch (error) {
      if (idempotencyKey && reservation?.reserved && !isUnknownOutcome(error)) {
        await releaseIdempotency(principal, reservation.recordId, idempotencyKey);
      }
      throw error;
    }
  },
);

export default exactEditsRoute;
