import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  status: {
    data: { completed: false } as { completed: boolean } | undefined,
    isError: false,
    isPending: false,
    refetch: vi.fn(),
  },
}));

vi.mock('../../hooks/useOnboarding', () => ({
  useOnboardingStatus: () => mocks.status,
}));

import { OnboardingGate } from './OnboardingGate';

function renderGate() {
  return render(
    <MemoryRouter initialEntries={['/app']}>
      <Routes>
        <Route
          path="/app"
          element={
            <OnboardingGate>
              <p>Workspace</p>
            </OnboardingGate>
          }
        />
        <Route path="/onboarding/1" element={<p>Onboarding</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('OnboardingGate', () => {
  beforeEach(() => {
    mocks.status.data = { completed: false };
    mocks.status.isError = false;
    mocks.status.isPending = false;
  });

  it('redirects users with incomplete onboarding', () => {
    renderGate();

    expect(screen.getByText('Onboarding')).toBeInTheDocument();
    expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
  });

  it('renders the protected content after onboarding is completed', () => {
    mocks.status.data = { completed: true };

    renderGate();

    expect(screen.getByText('Workspace')).toBeInTheDocument();
  });
});
