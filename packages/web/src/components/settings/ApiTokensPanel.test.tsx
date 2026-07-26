import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiTokensPanel } from './ApiTokensPanel';

const hooks = vi.hoisted(() => ({
  create: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock('../../hooks/useApiTokens', () => ({
  useApiTokens: () => ({ data: [], isLoading: false, isError: false }),
  useCreateApiToken: () => ({ mutate: hooks.create, isPending: false }),
  useRevokeApiToken: () => ({ mutate: hooks.revoke }),
}));

describe('ApiTokensPanel', () => {
  it('defaults to no expiry and supports selecting an expiry', async () => {
    const user = userEvent.setup();
    render(<ApiTokensPanel />);

    expect(screen.getByRole('combobox', { name: 'Expiry' })).toHaveValue('');
    await user.type(screen.getByLabelText('Token name'), 'Build agent');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Expiry' }), '30');
    const beforeCreate = Date.now();
    await user.click(screen.getByRole('button', { name: 'Create token' }));

    expect(hooks.create).toHaveBeenCalledOnce();
    const request = hooks.create.mock.calls[0]?.[0] as {
      name: string;
      canWrite: boolean;
      expiresAt: string | null;
    };
    expect(request).toMatchObject({ name: 'Build agent', canWrite: false });
    expect(new Date(request.expiresAt ?? '').getTime()).toBeGreaterThanOrEqual(
      beforeCreate + 30 * 24 * 60 * 60 * 1000,
    );
  });
});
