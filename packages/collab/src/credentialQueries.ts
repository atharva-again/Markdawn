import type { Pool } from 'pg';
import {
  type AuthenticatedCredential,
  authenticatedCredentialKey,
} from './authenticatedCredential';

export type AuthenticatedCandidate = { userId: string; credential: AuthenticatedCredential };
export type CredentialState = { valid: boolean; accessRevision: string };
type SessionQueryExecutor = Pick<Pool, 'query'>;

export type AuthenticatedSession = {
  credential: AuthenticatedCredential;
  user: {
    id: string;
    email: string;
    name: string;
    avatarUrl: string | null;
  };
  accessRevision: string;
};

export function credentialStateKey(candidate: AuthenticatedCandidate): string {
  return `${candidate.userId}:${authenticatedCredentialKey(candidate.credential)}`;
}

type CredentialStateRow = {
  user_id: string;
  credential_raw: string;
  valid: boolean;
  access_revision: string;
};

export async function queryCredentialStates(
  executor: SessionQueryExecutor,
  candidates: readonly AuthenticatedCandidate[],
): Promise<Map<string, CredentialState>> {
  if (candidates.length === 0) return new Map();
  const sessions = candidates.filter(
    (
      candidate,
    ): candidate is AuthenticatedCandidate & {
      credential: Extract<AuthenticatedCredential, { kind: 'session' }>;
    } => candidate.credential.kind === 'session',
  );
  const internal = candidates.filter(
    (
      candidate,
    ): candidate is AuthenticatedCandidate & {
      credential: Extract<AuthenticatedCredential, { kind: 'internal' }>;
    } => candidate.credential.kind === 'internal',
  );
  const [sessionResult, internalRevisionResult] = await Promise.all([
    sessions.length === 0
      ? Promise.resolve({ rows: [] as CredentialStateRow[] })
      : executor.query<CredentialStateRow>(
          `with requested as (
             select distinct *
             from unnest($1::uuid[], $2::text[]) as item(user_id, credential_raw)
           )
           select requested.user_id, requested.credential_raw,
                  is_active_session(requested.user_id, requested.credential_raw) as valid,
                  coalesce((select max(version) from workspace_access_versions), 0)::text
                    as access_revision
           from requested`,
          [
            sessions.map((candidate) => candidate.userId),
            sessions.map((candidate) => candidate.credential.raw),
          ],
        ),
    internal.length === 0
      ? Promise.resolve({ rows: [] as Array<{ access_revision: string }> })
      : executor.query<{ access_revision: string }>(
          `select coalesce((select max(version) from workspace_access_versions), 0)::text
             as access_revision`,
        ),
  ]);
  const sessionCandidates = new Map(
    sessions.map((candidate) => [`${candidate.userId}:${candidate.credential.raw}`, candidate]),
  );
  const states = new Map<string, CredentialState>();
  for (const row of sessionResult.rows) {
    const candidate = sessionCandidates.get(`${row.user_id}:${row.credential_raw}`);
    if (candidate) {
      states.set(credentialStateKey(candidate), {
        valid: row.valid,
        accessRevision: row.access_revision,
      });
    }
  }
  const internalAccessRevision = internalRevisionResult.rows[0]?.access_revision;
  if (internal.length > 0 && !internalAccessRevision) {
    throw new Error('Missing internal access revision');
  }
  for (const candidate of internal) {
    states.set(credentialStateKey(candidate), {
      valid: true,
      accessRevision: internalAccessRevision ?? '0',
    });
  }
  return states;
}

export async function queryCredentialState(
  executor: SessionQueryExecutor,
  candidate: AuthenticatedCandidate,
): Promise<CredentialState | undefined> {
  return (await queryCredentialStates(executor, [candidate])).get(credentialStateKey(candidate));
}

type UserRow = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  accessRevision: string;
};

export async function queryAuthenticatedSession(
  executor: SessionQueryExecutor,
  rawCredential: string,
): Promise<AuthenticatedSession | undefined> {
  const credential = {
    kind: 'session',
    raw: rawCredential,
  } satisfies Extract<AuthenticatedCredential, { kind: 'session' }>;
  const result = await executor.query<UserRow>(
    `select users.id, users.email, users.name, users.image as "avatarUrl",
            coalesce((select max(version) from workspace_access_versions), 0)::text
              as "accessRevision"
     from sessions
     join users on users.id = sessions.user_id
     where sessions.token = $1 and is_active_session(sessions.user_id, sessions.token)
     limit 1`,
    [credential.raw],
  );
  const user = result.rows[0];
  if (!user) return undefined;
  return {
    credential,
    user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
    accessRevision: user.accessRevision,
  };
}
