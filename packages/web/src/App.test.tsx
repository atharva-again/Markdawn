import { screen } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { render } from './test-utils/render';

const authState = vi.hoisted(() => ({
  data: { user: null, session: null } as { user: { id: string } | null; session: null },
  isPending: false,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    BrowserRouter: ({ children }: { children: React.ReactNode }) => children,
  };
});

vi.mock('./hooks/useAuth', () => ({
  AuthSessionProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    data: authState.data,
    isPending: authState.isPending,
    error: null,
    refetch: vi.fn(),
  }),
}));

describe('App', () => {
  beforeEach(() => {
    authState.data = { user: null, session: null };
    authState.isPending = false;
  });

  it('renders the landing page at /', () => {
    render(<App />, { route: '/' });

    expect(screen.getByText('Welcome to Markdawn')).toBeInTheDocument();
  });

  it('renders login page at /login', () => {
    render(<App />, { route: '/login' });

    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument();
  });

  it('does not flash the login screen while the initial session is loading', () => {
    authState.isPending = true;

    render(<App />, { route: '/login' });

    expect(screen.getByRole('status', { name: 'Loading application' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /continue with google/i })).not.toBeInTheDocument();
  });

  it('redirects protected route to login when unauthenticated', () => {
    render(<App />, { route: '/app' });

    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument();
  });
});
