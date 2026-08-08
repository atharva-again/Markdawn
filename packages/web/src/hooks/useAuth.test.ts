import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { mockUseSession } = vi.hoisted(() => ({
  mockUseSession: vi.fn(),
}));

vi.mock('../lib/auth-client', () => ({
  authClient: {
    useSession: mockUseSession,
  },
}));

import { AuthSessionProvider, useAuth } from './useAuth';

const wrapper = AuthSessionProvider;

describe('useAuth', () => {
  it('returns the session from authClient.useSession', () => {
    const mockSession = {
      data: { user: { id: '1', email: 'a@b.com', name: 'Test' }, session: { id: 's1' } },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    };
    mockUseSession.mockReturnValue(mockSession);

    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.data).toBe(mockSession.data);
    expect(result.current.refetch).toBe(mockSession.refetch);
    expect(mockUseSession).toHaveBeenCalled();
  });

  it('returns loading state when session is pending', () => {
    const mockSession = {
      data: null,
      isPending: true,
      error: null,
      refetch: vi.fn(),
    };
    mockUseSession.mockReturnValue(mockSession);

    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.isPending).toBe(true);
    expect(result.current.data).toBeNull();
  });

  it('returns null user when unauthenticated', () => {
    const mockSession = {
      data: { user: null, session: null },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    };
    mockUseSession.mockReturnValue(mockSession);

    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.data?.user).toBeNull();
    expect(result.current.isPending).toBe(false);
  });

  it('keeps the last successful session during a temporary refresh failure', async () => {
    const successfulSession = {
      data: { user: { id: '1', email: 'a@b.com', name: 'Test' }, session: { id: 's1' } },
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    };
    mockUseSession.mockReturnValue(successfulSession);

    const { result, rerender } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.hasEstablishedSession).toBe(true));

    mockUseSession.mockReturnValue({
      ...successfulSession,
      data: null,
      error: { status: 503 },
    });
    rerender();

    expect(result.current.data).toBe(successfulSession.data);
    expect(result.current.isInitialError).toBe(false);
  });

  it('does not restore an authenticated session after an authoritative 401', async () => {
    const successfulSession = {
      data: { user: { id: '1', email: 'a@b.com', name: 'Test' }, session: { id: 's1' } },
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    };
    mockUseSession.mockReturnValue(successfulSession);

    const { result, rerender } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.hasEstablishedSession).toBe(true));

    mockUseSession.mockReturnValue({
      ...successfulSession,
      data: null,
      error: { status: 401 },
    });
    rerender();
    await waitFor(() => expect(result.current.data).toBeNull());

    mockUseSession.mockReturnValue({
      ...successfulSession,
      data: null,
      error: { status: 503 },
    });
    rerender();

    expect(result.current.data).toBeNull();
    expect(result.current.isInitialError).toBe(false);
  });

  it('treats an initial retry as loading instead of a settled error', () => {
    const failedSession = {
      data: null,
      isPending: false,
      isRefetching: false,
      error: { status: 503 },
      refetch: vi.fn(),
    };
    mockUseSession.mockReturnValue(failedSession);

    const { result, rerender } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.isInitialError).toBe(true);

    mockUseSession.mockReturnValue({ ...failedSession, isRefetching: true });
    rerender();

    expect(result.current.isInitialError).toBe(false);
  });
});
