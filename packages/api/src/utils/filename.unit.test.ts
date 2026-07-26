import { describe, expect, it } from 'vitest';
import {
  allocateFilename,
  attachmentContentDisposition,
  MAX_SAFE_FILENAME_BYTES,
  readableFilename,
} from './filename';

describe('readableFilename', () => {
  it('preserves readable page title formatting', () => {
    expect(readableFilename('  Project Plan 2026  ')).toBe('Project Plan 2026');
  });

  it('removes cross-platform invalid filename characters', () => {
    expect(readableFilename('Plans: Q1/Q2?')).toBe('Plans- Q1-Q2-');
  });

  it('removes DEL and other control characters', () => {
    expect(readableFilename('Plan\u007f\nDraft')).toBe('PlanDraft');
  });

  it.each([
    ['CON', 'CON_'],
    ['CON.txt', 'CON_.txt'],
    ['lpt1.backup', 'lpt1_.backup'],
    ['notes.txt', 'notes.txt'],
  ])('handles Windows device names in %s', (value, expected) => {
    expect(readableFilename(value)).toBe(expected);
  });
});

describe('allocateFilename', () => {
  it('tracks every final filename case-insensitively', () => {
    const used = new Set<string>();
    expect(allocateFilename('A', '.md', used)).toBe('A.md');
    expect(allocateFilename('a', '.md', used)).toBe('a (2).md');
    expect(allocateFilename('A (2)', '.md', used)).toBe('A (3).md');
  });

  it('limits multibyte filenames while preserving suffixes and extensions', () => {
    const used = new Set<string>();
    const first = allocateFilename('研'.repeat(200), '.md', used);
    const second = allocateFilename('研'.repeat(200), '.md', used);
    expect(Buffer.byteLength(first, 'utf8')).toBeLessThanOrEqual(MAX_SAFE_FILENAME_BYTES);
    expect(Buffer.byteLength(second, 'utf8')).toBeLessThanOrEqual(MAX_SAFE_FILENAME_BYTES);
    expect(second).toMatch(/ \(2\)\.md$/);
  });
});

describe('attachmentContentDisposition', () => {
  it('preserves Unicode filenames through RFC 5987 encoding', () => {
    expect(attachmentContentDisposition('研究 notes.md')).toBe(
      `attachment; filename="__ notes.md"; filename*=UTF-8''%E7%A0%94%E7%A9%B6%20notes.md`,
    );
  });

  it('escapes every RFC 8187-incompatible character left by encodeURIComponent', () => {
    expect(attachmentContentDisposition("notes'()*!.md")).toBe(
      `attachment; filename="notes'()*!.md"; filename*=UTF-8''notes%27%28%29%2A!.md`,
    );
  });
});
