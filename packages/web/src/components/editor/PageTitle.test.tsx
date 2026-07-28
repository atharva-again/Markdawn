import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../hooks/usePageTitle', () => ({
  usePageTitle: vi.fn(),
}));

import { usePageTitle } from '../../hooks/usePageTitle';
import { PageTitle } from './PageTitle';

const mockUsePageTitle = vi.mocked(usePageTitle);

describe('PageTitle', () => {
  beforeEach(() => {
    mockUsePageTitle.mockReturnValue({
      title: 'Test Page',
      setTitle: vi.fn(),
      commitTitle: vi.fn(),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders with initial title', () => {
    render(<PageTitle pageId="p1" initialTitle="Test Page" />);

    const input = screen.getByTestId('page-title');
    expect(input).toHaveValue('Test Page');
  });

  it('calls setTitle on user input', async () => {
    function Wrapper() {
      const [title, setTitle] = useState('Test Page');
      mockUsePageTitle.mockReturnValue({ title, setTitle, commitTitle: vi.fn() });
      return <PageTitle pageId="p1" initialTitle="Test Page" />;
    }

    const user = userEvent.setup();
    render(<Wrapper />);

    const input = screen.getByTestId('page-title');
    await user.clear(input);
    await user.type(input, 'New Title');

    expect(input).toHaveValue('New Title');
  });

  it('has correct placeholder', () => {
    render(<PageTitle pageId="p1" initialTitle="" />);

    const input = screen.getByTestId('page-title');
    expect(input).toHaveAttribute('placeholder', 'Page Title');
  });

  it('limits titles by Unicode code points rather than UTF-16 units', () => {
    function Wrapper() {
      const [title, setTitle] = useState('');
      mockUsePageTitle.mockReturnValue({ title, setTitle, commitTitle: vi.fn() });
      return <PageTitle pageId="p1" initialTitle="" />;
    }

    render(<Wrapper />);
    const input = screen.getByTestId('page-title');
    fireEvent.change(input, { target: { value: '😀'.repeat(251) } });

    expect(input).toHaveValue('😀'.repeat(250));
    expect(input).toHaveAttribute('maxlength', '500');
  });

  it('is an input element', () => {
    render(<PageTitle pageId="p1" initialTitle="Test" />);

    const input = screen.getByTestId('page-title');
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('type', 'text');
  });
});
