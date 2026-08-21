import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '../test-utils/render';
import { CommandPalette } from './CommandPalette';

const mockNavigate = vi.fn();
const mockMutate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({}),
  };
});

vi.mock('../hooks/use-pages', () => ({
  useCreatePage: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
}));

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is initially hidden', () => {
    render(<CommandPalette />);

    expect(screen.queryByPlaceholderText('Search pages...')).not.toBeInTheDocument();
  });

  it('opens when Ctrl+K is pressed', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    await user.keyboard('{Control>}k{/Control}');

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search pages...')).toBeInTheDocument();
    });
  });

  it('closes when Escape is pressed', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    await user.keyboard('{Control>}k{/Control}');
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search pages...')).toBeInTheDocument();
    });

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Search pages...')).not.toBeInTheDocument();
    });
  });

  it('shows "Type to search" prompt when empty', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    await user.keyboard('{Control>}k{/Control}');

    await waitFor(() => {
      expect(screen.getByText(/type to search/i)).toBeInTheDocument();
    });
  });

  it('shows "No results found" when query has no matches', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    } as Response);

    render(<CommandPalette />);

    await user.keyboard('{Control>}k{/Control}');
    await user.type(screen.getByPlaceholderText('Search pages...'), 'xyz');

    await waitFor(() => {
      expect(screen.getByText(/no results found/i)).toBeInTheDocument();
    });
  });

  it('displays search results', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [{ id: 'p1', title: 'Test Page', icon: null }],
        }),
    } as Response);

    render(<CommandPalette />);

    await user.keyboard('{Control>}k{/Control}');
    await user.type(screen.getByPlaceholderText('Search pages...'), 'test');

    await waitFor(() => {
      expect(screen.getByText('Test Page')).toBeInTheDocument();
    });
  });

  it('navigates when a result is clicked', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [{ id: 'p1', title: 'Test Page', icon: null }],
        }),
    } as Response);

    render(<CommandPalette />);

    await user.keyboard('{Control>}k{/Control}');
    await user.type(screen.getByPlaceholderText('Search pages...'), 'test');

    await waitFor(() => {
      expect(screen.getByText('Test Page')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Test Page'));

    expect(mockNavigate).toHaveBeenCalled();
  });

  it('shows "New Page" quick action', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    await user.keyboard('{Control>}k{/Control}');

    await waitFor(() => {
      expect(screen.getByText('New Page')).toBeInTheDocument();
    });
  });

  it('shows "Go to Trash" quick action', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    await user.keyboard('{Control>}k{/Control}');

    await waitFor(() => {
      expect(screen.getByText('Go to Trash')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Go to Trash'));

    expect(mockNavigate).toHaveBeenCalledWith('/trash');
  });

  it('has no accessibility violations when open', async () => {
    const user = userEvent.setup();
    const { container } = render(<CommandPalette />);

    await user.keyboard('{Control>}k{/Control}');
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search pages...')).toBeInTheDocument();
    });

    const results = await axe(container);
    expect(results.violations).toHaveLength(0);
  });
});
