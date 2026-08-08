import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { authClient } from '../lib/auth-client';

type AuthSession = ReturnType<typeof authClient.useSession>;
type AuthSessionData = AuthSession['data'];

export type AuthState = AuthSession & {
  hasEstablishedSession: boolean;
  isInitialError: boolean;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const session = authClient.useSession();
  const [lastSuccessfulData, setLastSuccessfulData] = useState<AuthSessionData | undefined>();
  const [hasEstablishedSession, setHasEstablishedSession] = useState(false);
  const isTransientError = session.error !== null && session.error.status !== 401;

  useEffect(() => {
    if (session.isPending || session.isRefetching) return;
    if (session.error === null) {
      setLastSuccessfulData(session.data);
      setHasEstablishedSession(true);
      return;
    }
    if (session.error.status === 401) {
      setLastSuccessfulData(null);
      setHasEstablishedSession(true);
    }
  }, [session.data, session.error, session.isPending, session.isRefetching]);

  const value = useMemo<AuthState>(
    () => ({
      ...session,
      data: isTransientError && hasEstablishedSession ? (lastSuccessfulData ?? null) : session.data,
      hasEstablishedSession,
      isInitialError:
        isTransientError && !hasEstablishedSession && !session.isPending && !session.isRefetching,
    }),
    [hasEstablishedSession, isTransientError, lastSuccessfulData, session],
  );

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthState {
  const authState = useContext(AuthContext);
  if (!authState) {
    throw new Error('useAuth must be used within AuthSessionProvider');
  }
  return authState;
}
