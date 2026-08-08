import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthState } from './useAuth';

type SessionRevalidationState = {
  entityId: string | null;
  status:
    | 'idle'
    | 'session-pending'
    | 'session-complete'
    | 'entity-pending'
    | 'entity-complete'
    | 'error';
};

export type ShareableSessionRevalidation =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'error'; retry: () => Promise<void> }
  | { status: 'logged-out' }
  | { status: 'forbidden' };

export function useShareableSessionRevalidation(
  entityId: string | null,
  isUnauthorized: boolean,
  auth: AuthState,
  retryEntity: () => Promise<unknown>,
): ShareableSessionRevalidation {
  const [revalidation, setRevalidation] = useState<SessionRevalidationState>({
    entityId: null,
    status: 'idle',
  });
  const generationRef = useRef(0);

  const revalidateSession = useCallback(async () => {
    if (!entityId) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const targetEntityId = entityId;
    setRevalidation({ entityId: targetEntityId, status: 'session-pending' });
    try {
      await auth.refetch({ query: { disableCookieCache: true } });
      if (generationRef.current !== generation) return;
      setRevalidation({ entityId: targetEntityId, status: 'session-complete' });
    } catch {
      // Better Auth normally resolves refetches even for request errors. This
      // catch handles an unexpected rejected refetch at a retry boundary.
      if (generationRef.current !== generation) return;
      setRevalidation({ entityId: targetEntityId, status: 'error' });
    }
  }, [auth.refetch, entityId]);

  const retryEntityAfterSession = useCallback(async () => {
    if (!entityId) return;
    const generation = generationRef.current;
    const targetEntityId = entityId;
    setRevalidation({ entityId: targetEntityId, status: 'entity-pending' });
    try {
      await retryEntity();
      if (generationRef.current !== generation) return;
      setRevalidation({ entityId: targetEntityId, status: 'entity-complete' });
    } catch {
      // A rejected query refetch is safe to translate here because this hook
      // owns the one post-session entity retry and exposes an explicit Retry.
      if (generationRef.current !== generation) return;
      setRevalidation({ entityId: targetEntityId, status: 'error' });
    }
  }, [entityId, retryEntity]);

  const needsSessionRevalidation =
    isUnauthorized && (revalidation.entityId !== entityId || revalidation.status === 'idle');

  useEffect(() => {
    if (needsSessionRevalidation) void revalidateSession();
  }, [needsSessionRevalidation, revalidateSession]);

  useEffect(
    () => () => {
      generationRef.current += 1;
    },
    [],
  );

  const sessionIsAuthenticated =
    revalidation.entityId === entityId &&
    revalidation.status === 'session-complete' &&
    !auth.isRefetching &&
    !!auth.data?.user &&
    auth.error === null;

  useEffect(() => {
    if (isUnauthorized && sessionIsAuthenticated) void retryEntityAfterSession();
  }, [isUnauthorized, retryEntityAfterSession, sessionIsAuthenticated]);

  useEffect(() => {
    if (!isUnauthorized && revalidation.entityId === entityId && revalidation.status !== 'idle') {
      setRevalidation({ entityId, status: 'idle' });
    }
  }, [entityId, isUnauthorized, revalidation.entityId, revalidation.status]);

  if (!isUnauthorized) return { status: 'idle' };
  if (
    revalidation.entityId !== entityId ||
    revalidation.status === 'session-pending' ||
    revalidation.status === 'entity-pending' ||
    (revalidation.status === 'session-complete' && auth.isRefetching)
  ) {
    return { status: 'pending' };
  }
  if (
    revalidation.status === 'error' ||
    (revalidation.status === 'session-complete' && auth.error !== null && auth.error.status !== 401)
  ) {
    return { status: 'error', retry: revalidateSession };
  }
  if (revalidation.status === 'entity-complete') return { status: 'forbidden' };
  if (revalidation.status !== 'session-complete') return { status: 'pending' };
  if (!auth.data?.user || auth.error?.status === 401) return { status: 'logged-out' };
  return { status: 'pending' };
}
