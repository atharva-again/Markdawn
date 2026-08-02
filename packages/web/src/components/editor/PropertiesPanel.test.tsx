import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorReadOnlyProvider } from '../../contexts/EditorReadOnlyContext';

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  showErrorToast: vi.fn(),
}));

vi.mock('../../hooks/use-pages', () => ({
  useUpdatePage: () => ({ mutate: mocks.mutate }),
}));

vi.mock('../../utils/toast', () => ({
  showErrorToast: mocks.showErrorToast,
}));

vi.mock('../../hooks/usePropertyMetadata', () => ({
  usePropertyMetadata: () => ({
    allKeys: ['status', 'owner', 'tags'],
    allTags: [],
    refreshTags: vi.fn(),
  }),
}));

import { PropertiesPanel } from './PropertiesPanel';

function panel(readOnly: boolean, properties: Record<string, unknown> = { status: 'Draft' }) {
  return (
    <EditorReadOnlyProvider readOnly={readOnly}>
      <PropertiesPanel pageId="page-1" properties={properties} />
    </EditorReadOnlyProvider>
  );
}

describe('PropertiesPanel permission changes', () => {
  beforeEach(() => {
    mocks.mutate.mockReset();
    mocks.showErrorToast.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it('cancels a value edit when the page becomes read-only without persisting', async () => {
    const rendered = render(panel(false));
    fireEvent.click(await screen.findByRole('button', { name: 'Draft' }));
    const valueInput = screen.getByTestId('value-input');
    fireEvent.change(valueInput, { target: { value: 'Private draft' } });

    rendered.rerender(panel(true));

    expect(screen.queryByTestId('value-input')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Draft' })).toBeInTheDocument();
    expect(screen.queryByTestId('delete-property')).not.toBeInTheDocument();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('cancels a pending key blur save when the page becomes read-only', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const rendered = render(panel(false));
    fireEvent.click(await screen.findByRole('button', { name: 'status' }));
    const keyInput = screen.getByTestId('key-input');
    fireEvent.change(keyInput, { target: { value: 'owner' } });
    fireEvent.blur(keyInput);

    rendered.rerender(panel(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(screen.queryByTestId('key-input')).not.toBeInTheDocument();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('persists a newly selected tags property as an empty array', async () => {
    render(panel(false, {}));
    fireEvent.click(await screen.findByTestId('add-property'));

    const keyInput = screen.getByTestId('key-input');
    fireEvent.change(keyInput, { target: { value: 'tags' } });
    fireEvent.keyDown(keyInput, { key: 'Enter' });

    expect(await screen.findByTestId('tag-input')).toBeInTheDocument();
    expect(mocks.mutate).toHaveBeenCalledWith({
      pageId: 'page-1',
      updates: { properties: { tags: [] } },
      silent: true,
    });
  });

  it('normalizes a scalar when renamed to tags', async () => {
    render(panel(false));
    fireEvent.click(await screen.findByRole('button', { name: 'status' }));

    const keyInput = screen.getByTestId('key-input');
    fireEvent.change(keyInput, { target: { value: 'tags' } });
    fireEvent.keyDown(keyInput, { key: 'Enter' });

    expect(await screen.findByTestId('tag-input')).toBeInTheDocument();
    expect(mocks.mutate).toHaveBeenCalledWith({
      pageId: 'page-1',
      updates: { properties: { tags: ['Draft'] } },
      silent: true,
    });
  });

  it.each([
    { name: 'object', value: { author: 'Alice' } },
    { name: 'mixed array', value: ['Draft', 42] },
  ])('rejects an invalid $name value when renamed to tags', async ({ value }) => {
    render(panel(false, { metadata: value }));
    fireEvent.click(await screen.findByRole('button', { name: 'metadata' }));

    const keyInput = screen.getByTestId('key-input');
    fireEvent.change(keyInput, { target: { value: 'tags' } });
    fireEvent.keyDown(keyInput, { key: 'Enter' });

    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.showErrorToast).toHaveBeenCalledWith('Tags can only contain string values');
    expect(screen.queryByTestId('key-input')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'metadata' })).toBeInTheDocument();
  });

  it('keeps an empty scalar value for ordinary new properties', async () => {
    render(panel(false, {}));
    fireEvent.click(await screen.findByTestId('add-property'));

    const keyInput = screen.getByTestId('key-input');
    fireEvent.change(keyInput, { target: { value: 'status' } });
    fireEvent.keyDown(keyInput, { key: 'Enter' });

    expect(await screen.findByTestId('value-input')).toBeInTheDocument();
    expect(mocks.mutate).toHaveBeenCalledWith({
      pageId: 'page-1',
      updates: { properties: { status: '' } },
      silent: true,
    });
  });
});
