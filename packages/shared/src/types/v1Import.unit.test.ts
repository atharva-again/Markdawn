import { describe, expect, it } from 'vitest';
import { getV1VaultImportKind } from './v1Import';

describe('getV1VaultImportKind', () => {
  it.each([
    ['notes/Note.md', 'markdown'],
    ['images/photo.png', 'image'],
    ['images/diagram.svg', 'unsupported-image'],
    ['notes/archive.pdf', null],
  ] as const)('classifies %s as %s', (path, expected) => {
    expect(getV1VaultImportKind(path)).toBe(expected);
  });

  it.each(['md', 'png'])('does not treat the bare extension %s as a file path', (path) => {
    expect(getV1VaultImportKind(path)).toBeNull();
  });
});
