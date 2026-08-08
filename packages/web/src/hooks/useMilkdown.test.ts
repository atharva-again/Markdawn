import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  convertDelimitedToMarkdown,
  createEditorWithTimeout,
  isLikelyTableData,
} from './useMilkdown';

afterEach(() => vi.useRealTimers());

describe('createEditorWithTimeout', () => {
  it('surfaces synchronous editor configuration failures', async () => {
    const failure = new Error('invalid editor configuration');

    await expect(
      createEditorWithTimeout(() => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });

  it('destroys an editor that finishes after initialization timed out', async () => {
    vi.useFakeTimers();
    const destroy = vi.fn(async () => undefined);
    let resolveEditor: ((editor: { destroy: () => Promise<void> }) => void) | undefined;
    const editorPromise = new Promise<{ destroy: () => Promise<void> }>((resolve) => {
      resolveEditor = resolve;
    });
    const result = createEditorWithTimeout(() => editorPromise, 100);
    const rejection = expect(result).rejects.toThrow('Editor initialization timed out');

    await vi.advanceTimersByTimeAsync(100);
    await rejection;

    resolveEditor?.({ destroy });
    await vi.advanceTimersByTimeAsync(0);
    expect(destroy).toHaveBeenCalledOnce();
  });
});

describe('isLikelyTableData', () => {
  it('returns true for tab-separated data with 2+ columns', () => {
    expect(isLikelyTableData('a\tb\n1\t2')).toBe(true);
    expect(isLikelyTableData('name\tage\nAlice\t30\nBob\t25')).toBe(true);
  });

  it('returns true for comma-separated data with 2+ fields', () => {
    expect(isLikelyTableData('a,b\n1,2')).toBe(true);
    expect(isLikelyTableData('name,age\nAlice,30')).toBe(true);
  });

  it('returns false for single column data', () => {
    expect(isLikelyTableData('just one value')).toBe(false);
    expect(isLikelyTableData('a\nb\nc')).toBe(false);
  });

  it('returns false for non-tabular content', () => {
    expect(isLikelyTableData('Hello world')).toBe(false);
    expect(isLikelyTableData('# Hello\nThis is a paragraph')).toBe(false);
    expect(isLikelyTableData('')).toBe(false);
  });

  it('returns false for single line', () => {
    expect(isLikelyTableData('a,b,c')).toBe(false);
    expect(isLikelyTableData('\t')).toBe(false);
  });

  it('rejects inconsistent column counts', () => {
    expect(isLikelyTableData('a,b\n1,2,3')).toBe(false);
    expect(isLikelyTableData('a\tb\tc\n1\t2')).toBe(false);
  });

  it('handles empty cells', () => {
    expect(isLikelyTableData('a\tb\t\n1\t2\t3')).toBe(true);
    expect(isLikelyTableData(',\n,')).toBe(true);
  });
});

describe('convertDelimitedToMarkdown', () => {
  it('converts tab-separated data to markdown table', () => {
    const result = convertDelimitedToMarkdown('a\tb\n1\t2');
    expect(result).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |');
  });

  it('converts comma-separated data to markdown table', () => {
    const result = convertDelimitedToMarkdown('name,age\nAlice,30');
    expect(result).toBe('| name | age |\n| --- | --- |\n| Alice | 30 |');
  });

  it('handles multiple rows', () => {
    const result = convertDelimitedToMarkdown('a,b,c\n1,2,3\n4,5,6');
    expect(result).toBe('| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |');
  });

  it('pads rows with fewer columns', () => {
    const result = convertDelimitedToMarkdown('a,b,c\n1,2\n3');
    expect(result).toBe('| a | b | c |\n| --- | --- | --- |\n| 1 | 2 |  |\n| 3 |  |  |');
  });

  it('trims cell content', () => {
    const result = convertDelimitedToMarkdown('  a  \tb  \n  1  \t  2  ');
    expect(result).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |');
  });
});
