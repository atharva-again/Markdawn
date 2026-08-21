import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: {
    data: { user: { id: 'user-1' } } as { user: { id: string } } | null,
    isPending: false,
  },
  status: {
    data: { completed: false } as { completed: boolean } | undefined,
    isError: false,
    isPending: false,
    refetch: vi.fn(),
  },
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => mocks.auth,
}));

vi.mock('../../hooks/useOnboarding', () => ({
  useOnboardingStatus: () => mocks.status,
}));

import { OnboardingGate } from './OnboardingGate';

function renderGate(initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/*"
          element={
            <OnboardingGate>
              <p>Workspace</p>
            </OnboardingGate>
          }
        />
        <Route path="/onboarding/1" element={<OnboardingProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

function OnboardingProbe() {
  const location = useLocation();
  const state = location.state as { destination?: string } | null;
  return (
    <>
      <p>Onboarding</p>
      <output data-testid="destination">{state?.destination ?? ''}</output>
    </>
  );
}

describe('OnboardingGate', () => {
  beforeEach(() => {
    mocks.auth.data = { user: { id: 'user-1' } };
    mocks.auth.isPending = false;
    mocks.status.data = { completed: false };
    mocks.status.isError = false;
    mocks.status.isPending = false;
  });

  it('redirects users with incomplete onboarding', () => {
    renderGate('/settings?tab=tokens#new');

    expect(screen.getByText('Onboarding')).toBeInTheDocument();
    expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
    expect(screen.getByTestId('destination')).toHaveTextContent('/settings?tab=tokens#new');
  });

  it('renders the protected content after onboarding is completed', () => {
    mocks.status.data = { completed: true };

    renderGate();

    expect(screen.getByText('Workspace')).toBeInTheDocument();
  });

  it('does not enforce onboarding for anonymous public links', () => {
    mocks.auth.data = null;

    renderGate('/public-page');

    expect(screen.getByText('Workspace')).toBeInTheDocument();
  });
});
