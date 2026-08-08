import { render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  destroy: vi.fn(async () => undefined),
  editability: [] as boolean[],
  makeEditor: vi.fn(),
  repairDocument: vi.fn(),
  setPropsError: null as Error | null,
  setProps: vi.fn((props: { editable?: (() => boolean) | undefined }) => {
    if (mocks.setPropsError) throw mocks.setPropsError;
    if (props.editable) mocks.editability.push(props.editable());
  }),
}));

vi.mock('@milkdown/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@milkdown/core')>();
  return {
    ...original,
    Editor: { make: mocks.makeEditor },
  };
});

vi.mock('../logger-init', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../editor/utils/documentRepair', () => ({
  repairDocument: mocks.repairDocument,
}));

import { useMilkdown } from './useMilkdown';

function MilkdownHarness({ readOnly }: { readOnly: boolean }) {
  const { initializationState, setContainer } = useMilkdown({ readOnly });
  return createElement('div', {
    'data-state': initializationState.status,
    'data-testid': 'milkdown-harness',
    ref: setContainer,
  });
}

describe('useMilkdown permission changes', () => {
  beforeEach(() => {
    mocks.destroy.mockClear();
    mocks.editability.length = 0;
    mocks.makeEditor.mockReset();
    mocks.repairDocument.mockReset();
    mocks.setPropsError = null;
    mocks.setProps.mockClear();
    mocks.makeEditor.mockImplementation(() => {
      const editor = {
        action: (run: (ctx: { get: () => unknown }) => void) => {
          run({ get: () => ({ setProps: mocks.setProps }) });
        },
        config: () => editor,
        create: async () => editor,
        destroy: mocks.destroy,
        use: () => editor,
      };
      return editor;
    });
  });

  it('updates editability without destroying and recreating the editor', async () => {
    const { rerender } = render(createElement(MilkdownHarness, { readOnly: true }));

    await waitFor(() => {
      expect(mocks.makeEditor).toHaveBeenCalledOnce();
      expect(mocks.editability).toContain(false);
    });

    rerender(createElement(MilkdownHarness, { readOnly: false }));

    await waitFor(() => {
      expect(mocks.editability).toContain(true);
    });
    await waitFor(() => {
      expect(mocks.repairDocument).toHaveBeenCalledOnce();
    });
    expect(mocks.makeEditor).toHaveBeenCalledOnce();
    expect(mocks.destroy).not.toHaveBeenCalled();
  });

  it('cancels a pending repair when the editor becomes read-only again', async () => {
    const { rerender } = render(createElement(MilkdownHarness, { readOnly: true }));
    await waitFor(() => expect(mocks.makeEditor).toHaveBeenCalledOnce());

    rerender(createElement(MilkdownHarness, { readOnly: false }));
    await waitFor(() => expect(mocks.editability).toContain(true));
    rerender(createElement(MilkdownHarness, { readOnly: true }));

    await new Promise((resolve) => window.setTimeout(resolve, 600));
    expect(mocks.repairDocument).not.toHaveBeenCalled();
  });

  it('surfaces live permission update failures as an editor error', async () => {
    const { rerender } = render(createElement(MilkdownHarness, { readOnly: true }));
    await waitFor(() => {
      expect(screen.getByTestId('milkdown-harness')).toHaveAttribute('data-state', 'ready');
    });

    mocks.setPropsError = new Error('permission update failed');
    rerender(createElement(MilkdownHarness, { readOnly: false }));

    await waitFor(() => {
      expect(screen.getByTestId('milkdown-harness')).toHaveAttribute('data-state', 'error');
    });
    expect(mocks.makeEditor).toHaveBeenCalledOnce();
  });
});
