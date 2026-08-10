import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../hooks/use-pages', () => ({
  useImportMarkdown: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}));

import { ContentSetupStep } from './ContentSetupStep';

describe('ContentSetupStep', () => {
  it('does not show a completion error in the import flow', async () => {
    const user = userEvent.setup();

    render(
      <ContentSetupStep
        completionError="We could not save your onboarding progress."
        isCompleting={false}
        onAdvance={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'We could not save your onboarding progress.',
    );

    await user.click(screen.getByRole('button', { name: /Import Content/i }));

    expect(
      screen.queryByText('We could not save your onboarding progress.'),
    ).not.toBeInTheDocument();
  });
});
