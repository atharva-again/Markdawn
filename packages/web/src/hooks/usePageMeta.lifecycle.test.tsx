import { QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createIdentityLifecycle,
  type IdentityLifecycle,
  IdentityLifecycleProvider,
} from '../contexts/IdentityLifecycleContext';
import { createTestQueryClient } from '../test-utils/render';

const mocks = vi.hoisted(() => ({
  userId: 'user-a',
  refetchSession: vi.fn(),
  getSession: vi.fn(),
  providerHandlers: new Map<string, (payload: unknown) => void>(),
  initialAuthenticationFailure: null as { reason: string } | null,
  initialClose: null as { event: CloseEvent } | null,
  providerDestroy: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@hocuspocus/provider', () => {
  class MockProvider {
    constructor(configuration: {
      onAuthenticationFailed?: (payload: unknown) => void;
      onClose?: (payload: unknown) => void;
      token?: () => Promise<string>;
    }) {
      if (configuration.onAuthenticationFailed) {
        mocks.providerHandlers.set('authenticationFailed', configuration.onAuthenticationFailed);
        if (mocks.initialAuthenticationFailure) {
          configuration.onAuthenticationFailed(mocks.initialAuthenticationFailure);
        }
      }
      if (configuration.onClose) {
        mocks.providerHandlers.set('close', configuration.onClose);
        if (mocks.initialClose) configuration.onClose(mocks.initialClose);
      }
      if (configuration.token) mocks.providerHandlers.set('token', configuration.token);
    }

    on = vi.fn((event: string, handler: (payload: unknown) => void) => {
      mocks.providerHandlers.set(event, handler);
    });
    off = vi.fn();
    connect = vi.fn(() => Promise.resolve());
    disconnect = vi.fn();
    destroy = mocks.providerDestroy;
  }

  return { HocuspocusProvider: MockProvider };
});

vi.mock('../lib/auth-client', () => ({
  authClient: {
    getSession: mocks.getSession,
  },
}));

vi.mock('./useAuth', () => ({
  useAuth: () => ({
    data: { user: { id: mocks.userId } },
    refetch: mocks.refetchSession,
  }),
}));

vi.mock('../logger-init', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  }),
}));

import { usePageMeta } from './usePageMeta';

function MetaHarness() {
  usePageMeta();
  const location = useLocation();
  return <output data-testid="location-path">{location.pathname}</output>;
}

function renderMeta(lifecycle: IdentityLifecycle = createIdentityLifecycle()) {
  const queryClient = createTestQueryClient();
  return {
    lifecycle,
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <IdentityLifecycleProvider lifecycle={lifecycle}>
            <MetaHarness />
          </IdentityLifecycleProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

function seedPrivateMetadata(queryClient: ReturnType<typeof createTestQueryClient>) {
  queryClient.setQueryData(['pageTree'], [{ id: 'private-page', title: 'Private page' }]);
  queryClient.setQueryData(['folderTree'], [{ id: 'private-folder', title: 'Private folder' }]);
}

describe('usePageMeta authentication lifecycle', () => {
  beforeEach(() => {
    mocks.userId = 'user-a';
    mocks.refetchSession.mockReset();
    mocks.refetchSession.mockResolvedValue(undefined);
    mocks.getSession.mockReset();
    mocks.getSession.mockResolvedValue({
      data: { user: { id: 'user-a' }, session: { token: 'token-a' } },
    });
    mocks.providerHandlers.clear();
    mocks.initialAuthenticationFailure = null;
    mocks.initialClose = null;
    mocks.providerDestroy.mockReset();
    mocks.loggerWarn.mockReset();
    mocks.loggerError.mockReset();
  });

  it('retires cached dashboard metadata after meta-room authentication fails', () => {
    const { getByTestId, lifecycle, queryClient } = renderMeta();
    seedPrivateMetadata(queryClient);
    const clearSpy = vi.spyOn(queryClient, 'clear');

    act(() => {
      mocks.providerHandlers.get('authenticationFailed')?.({ reason: 'Unauthorized' });
    });

    expect(getByTestId('location-path')).toHaveTextContent('/login');
    expect(queryClient.getQueryData(['pageTree'])).toBeUndefined();
    expect(queryClient.getQueryData(['folderTree'])).toBeUndefined();
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(lifecycle.isActive()).toBe(false);
    expect(mocks.refetchSession).toHaveBeenCalledTimes(1);
  });

  it.each([
    { code: 1000, reason: 'Session expired' },
    { code: 1000, reason: 'Access revoked' },
    { code: 1000, reason: 'Permission verification failed' },
    { code: 4401, reason: '' },
    { code: 4500, reason: '' },
  ])('retires cached metadata on terminal close code=$code reason=$reason', ({ code, reason }) => {
    const { getByTestId, queryClient } = renderMeta();
    seedPrivateMetadata(queryClient);

    act(() => {
      mocks.providerHandlers.get('close')?.({
        event: new CloseEvent('close', { code, reason }),
      });
    });

    expect(getByTestId('location-path')).toHaveTextContent('/login');
    expect(queryClient.getQueryData(['pageTree'])).toBeUndefined();
    expect(mocks.refetchSession).toHaveBeenCalledTimes(1);
  });

  it('preserves metadata on an ordinary transport close', () => {
    const { getByTestId, lifecycle, queryClient } = renderMeta();
    seedPrivateMetadata(queryClient);

    act(() => {
      mocks.providerHandlers.get('close')?.({
        event: new CloseEvent('close', { code: 1006, reason: 'network failure' }),
      });
    });

    expect(getByTestId('location-path')).toHaveTextContent('/');
    expect(queryClient.getQueryData(['pageTree'])).toEqual([
      { id: 'private-page', title: 'Private page' },
    ]);
    expect(lifecycle.isActive()).toBe(true);
    expect(mocks.refetchSession).not.toHaveBeenCalled();
  });

  it('handles authentication failure during provider construction without restoring metadata', () => {
    mocks.initialAuthenticationFailure = { reason: 'Unauthorized' };

    const { getByTestId, lifecycle, queryClient } = renderMeta();

    expect(getByTestId('location-path')).toHaveTextContent('/login');
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(lifecycle.isActive()).toBe(false);
    expect(mocks.refetchSession).toHaveBeenCalledTimes(1);
    expect(mocks.providerDestroy).toHaveBeenCalledTimes(1);
  });

  it('handles a terminal close during provider construction', () => {
    mocks.initialClose = {
      event: new CloseEvent('close', { code: 1000, reason: 'Session expired' }),
    };

    const { getByTestId, lifecycle } = renderMeta();

    expect(getByTestId('location-path')).toHaveTextContent('/login');
    expect(lifecycle.isActive()).toBe(false);
    expect(mocks.refetchSession).toHaveBeenCalledTimes(1);
    expect(mocks.providerDestroy).toHaveBeenCalledTimes(1);
  });

  it('deduplicates authentication failure and terminal close retirement', () => {
    const { queryClient } = renderMeta();
    const clearSpy = vi.spyOn(queryClient, 'clear');

    act(() => {
      mocks.providerHandlers.get('authenticationFailed')?.({ reason: 'Unauthorized' });
      mocks.providerHandlers.get('close')?.({
        event: new CloseEvent('close', { code: 1000, reason: 'Session expired' }),
      });
    });

    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(mocks.refetchSession).toHaveBeenCalledTimes(1);
    expect(mocks.loggerWarn).toHaveBeenCalledTimes(1);
  });

  it('ignores terminal events delivered after the identity retires', () => {
    const { getByTestId, lifecycle, queryClient } = renderMeta();
    seedPrivateMetadata(queryClient);
    lifecycle.retire();

    act(() => {
      mocks.providerHandlers.get('authenticationFailed')?.({ reason: 'Unauthorized' });
      mocks.providerHandlers.get('close')?.({
        event: new CloseEvent('close', { code: 1000, reason: 'Session expired' }),
      });
    });

    expect(getByTestId('location-path')).toHaveTextContent('/');
    expect(queryClient.getQueryData(['folderTree'])).toEqual([
      { id: 'private-folder', title: 'Private folder' },
    ]);
    expect(mocks.refetchSession).not.toHaveBeenCalled();
  });
});
