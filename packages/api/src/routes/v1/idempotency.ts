import { sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { query } from '../../db/query';
import { type V1Principal, v1IdempotencyPrincipal } from '../../middleware/v1Auth';

const RESERVATION_SECONDS = 5 * 60;
const IDEMPOTENCY_RETRY_AFTER_SECONDS = 1;

type StoredResponse = { etag: string };

type IdempotencyRecord<T extends StoredResponse> = {
  request_hash: string;
  response: T | null;
};

function idempotencyConflict(
  code: 'idempotency_reservation_missing' | 'idempotency_key_mismatch' | 'idempotency_in_progress',
  message: string,
  retryAfterSeconds?: number,
): HTTPException {
  return new HTTPException(409, {
    message,
    cause: { code, ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) },
  });
}

export async function reserveIdempotency<T extends StoredResponse>(
  principal: V1Principal,
  key: string,
  requestHash: string,
): Promise<{ reserved: true; recordId: string; replay: null } | { reserved: false; replay: T }> {
  if (!key || key.length > 200) {
    throw new HTTPException(400, {
      message: 'Idempotency-Key must be between 1 and 200 characters',
    });
  }
  const owner = v1IdempotencyPrincipal(principal);
  const inserted = await query<{ id: string }>(
    sql`insert into api_idempotency_records
          (principal_key, idempotency_key, request_hash, expires_at)
        values (
          ${owner}, ${key}, ${requestHash},
          now() + (${RESERVATION_SECONDS} * interval '1 second')
        )
        on conflict (principal_key, idempotency_key) do update set
          id = gen_random_uuid(), request_hash = excluded.request_hash,
          response = null, etag = null, expires_at = excluded.expires_at,
          created_at = now()
        where api_idempotency_records.expires_at <= now()
        returning id`,
  );
  const recordId = inserted.rows[0]?.id;
  if (recordId) return { reserved: true, recordId, replay: null };

  const existing = await query<IdempotencyRecord<T>>(
    sql`select request_hash, response
        from api_idempotency_records
        where principal_key = ${owner} and idempotency_key = ${key}
        limit 1`,
  );
  const record = existing.rows[0];
  if (!record) {
    throw idempotencyConflict(
      'idempotency_reservation_missing',
      'Idempotency request is unavailable',
    );
  }
  if (record.request_hash !== requestHash) {
    throw idempotencyConflict(
      'idempotency_key_mismatch',
      'Idempotency-Key was already used with a different request',
    );
  }
  if (!record.response) {
    throw idempotencyConflict(
      'idempotency_in_progress',
      'A request with this Idempotency-Key is in progress',
      IDEMPOTENCY_RETRY_AFTER_SECONDS,
    );
  }
  return { reserved: false, replay: record.response };
}

export async function releaseIdempotency(
  principal: V1Principal,
  recordId: string,
  key: string,
): Promise<void> {
  await query(
    sql`delete from api_idempotency_records
        where principal_key = ${v1IdempotencyPrincipal(principal)}
          and id = ${recordId} and idempotency_key = ${key} and response is null`,
  );
}
