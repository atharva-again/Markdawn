import { sql } from 'drizzle-orm';
import { query } from '../db/query';

const RETENTION_BATCH_SIZE = 1_000;
const MAX_BATCHES_PER_RUN = 100;
export const OPERATIONAL_RETENTION_INTERVAL_MS = 60_000;

export type RetentionCleanupResult = {
  idempotencyRecords: number;
  tokenAuditEvents: number;
  oauthClientAssertions: number;
  oauthAccessTokenRevocations: number;
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

async function deleteExpiredOAuthClientAssertionsBatch(): Promise<number> {
  const result = await query(sql`with candidates as (
      select id from oauth_client_assertions
      where expires_at <= now()
      order by expires_at, id
      limit ${RETENTION_BATCH_SIZE}
      for update skip locked
    )
    delete from oauth_client_assertions assertions
    using candidates
    where assertions.id = candidates.id`);
  return result.rowCount ?? 0;
}

async function deleteExpiredOAuthAccessTokenRevocationsBatch(): Promise<number> {
  const result = await query(sql`with candidates as (
      select token_hash from oauth_access_token_revocations
      where expires_at <= now()
      order by expires_at, token_hash
      limit ${RETENTION_BATCH_SIZE}
      for update skip locked
    )
    delete from oauth_access_token_revocations revocations
    using candidates
    where revocations.token_hash = candidates.token_hash`);
  return result.rowCount ?? 0;
}

export async function drainOperationalRetention(): Promise<RetentionCleanupResult> {
  let idempotencyRecords = 0;
  let tokenAuditEvents = 0;
  let oauthClientAssertions = 0;
  let oauthAccessTokenRevocations = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
    const [idempotencyBatch, auditBatch, assertionBatch, revocationBatch] = await Promise.all([
      deleteExpiredIdempotencyBatch(),
      deleteExpiredTokenAuditBatch(),
      deleteExpiredOAuthClientAssertionsBatch(),
      deleteExpiredOAuthAccessTokenRevocationsBatch(),
    ]);
    idempotencyRecords += idempotencyBatch;
    tokenAuditEvents += auditBatch;
    oauthClientAssertions += assertionBatch;
    oauthAccessTokenRevocations += revocationBatch;
    if (
      idempotencyBatch < RETENTION_BATCH_SIZE &&
      auditBatch < RETENTION_BATCH_SIZE &&
      assertionBatch < RETENTION_BATCH_SIZE &&
      revocationBatch < RETENTION_BATCH_SIZE
    )
      break;
  }
  return {
    idempotencyRecords,
    tokenAuditEvents,
    oauthClientAssertions,
    oauthAccessTokenRevocations,
  };
}
