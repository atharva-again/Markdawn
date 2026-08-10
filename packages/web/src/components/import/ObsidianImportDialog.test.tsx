import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const directoryOpen = vi.hoisted(() => vi.fn());

vi.mock('browser-fs-access', () => ({ directoryOpen }));

import { ObsidianImportDialog } from './ObsidianImportDialog';

describe('ObsidianImportDialog', () => {
  beforeEach(() => {
    directoryOpen.mockReset();
    vi.unstubAllGlobals();
  });

  it('cannot be dismissed while an import is committing and returns one settled outcome', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const file = new File(['# Note'], 'note.md', { type: 'text/markdown' });
    directoryOpen.mockResolvedValue([file]);

    let resolveImport: ((response: Response) => void) | undefined;
    const importResponse = new Promise<Response>((resolve) => {
      resolveImport = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => importResponse),
    );

    render(<ObsidianImportDialog onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Select Vault' }));
    await user.click(await screen.findByRole('button', { name: 'Import Vault' }));

    expect(screen.getByRole('button', { name: 'Close Import Obsidian Vault' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();

    resolveImport?.(
      new Response(
        JSON.stringify({
          foldersCreated: 0,
          pagesCreated: 1,
          imagesUploaded: 0,
          backlinksCreated: 0,
          errors: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const doneButton = await screen.findByRole('button', { name: 'Done' });
    expect(screen.queryByText('Import failed')).not.toBeInTheDocument();
    await user.click(doneButton);
    expect(onClose).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith({ kind: 'imported' });
  });
});
