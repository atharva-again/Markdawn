import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  consent: vi.fn(),
  session: { data: { user: { id: 'user-1' } }, isPending: false },
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => mocks.session,
}));
vi.mock('../lib/auth-client', () => ({
  authClient: { oauth2: { consent: mocks.consent } },
}));

import OAuthAuthorize from './OAuthAuthorize';

function SwitchAuthorizationRequest() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() =>
        navigate('/oauth/authorize?client_id=client-1&scope=pages%3Aread+pages%3Awrite+openid')
      }
    >
      Switch request
    </button>
  );
}

describe('OAuthAuthorize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ client_id: 'client-1', client_name: 'Test application' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );
  });

  it('resets selected scopes when navigation changes the authorization request', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter
        initialEntries={['/oauth/authorize?client_id=client-1&scope=pages%3Aread+pages%3Awrite']}
      >
        <Routes>
          <Route
            path="/oauth/authorize"
            element={
              <>
                <OAuthAuthorize />
                <SwitchAuthorizationRequest />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    const writeScope = await screen.findByRole('checkbox', {
      name: 'Modify pages and folders',
    });
    expect(writeScope).toBeChecked();

    fireEvent.click(writeScope);
    await waitFor(() => expect(writeScope).not.toBeChecked());
    await user.click(screen.getByRole('button', { name: 'Switch request' }));

    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Modify pages and folders' })).toBeChecked(),
    );
  });
});
