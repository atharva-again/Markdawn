import { sql } from 'drizzle-orm';
import { query } from '../db/query';

const RETENTION_BATCH_SIZE = 1_000;
const MAX_BATCHES_PER_RUN = 100;
export const OPERATIONAL_RETENTION_INTERVAL_MS = 60_000;

export type RetentionCleanupResult = {
  idempotencyRecords: number;
  tokenAuditEvents: number;
};

async function deleteExpiredIdempotencyBatch(): Promise<number> {
  const result = await query(sql`with candidates as (
      select id from api_idempotency_records
      where expires_at <= now()
      order by expires_at, id
      limit ${RETENTION_BATCH_SIZE}
      for update skip locked
    )
    delete from api_idempotency_records records
    using candidates
    where records.id = candidates.id`);
  return result.rowCount ?? 0;
}

async function deleteExpiredTokenAuditBatch(): Promise<number> {
  const result = await query(sql`with candidates as (
      select id from api_token_audit_events
      where created_at < now() - interval '90 days'
      order by created_at, id
      limit ${RETENTION_BATCH_SIZE}
      for update skip locked
    )
    delete from api_token_audit_events events
    using candidates
    where events.id = candidates.id`);
  return result.rowCount ?? 0;
}

export async function drainOperationalRetention(): Promise<RetentionCleanupResult> {
  let idempotencyRecords = 0;
  let tokenAuditEvents = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
    const [idempotencyBatch, auditBatch] = await Promise.all([
      deleteExpiredIdempotencyBatch(),
      deleteExpiredTokenAuditBatch(),
    ]);
    idempotencyRecords += idempotencyBatch;
    tokenAuditEvents += auditBatch;
    if (idempotencyBatch < RETENTION_BATCH_SIZE && auditBatch < RETENTION_BATCH_SIZE) break;
  }
  return { idempotencyRecords, tokenAuditEvents };
}
