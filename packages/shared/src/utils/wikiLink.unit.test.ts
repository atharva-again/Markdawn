import { describe, expect, it } from 'vitest';
import { buildWikiLinkResolution, normalizeWikiLinkLookupKey } from './wikiLink';

describe('normalizeWikiLinkLookupKey', () => {
  it.each([
    ['Roadmap', 'roadmap'],
    ['/Roadmap.md#Plan', 'roadmap'],
    ['./Folder/Roadmap.MD', 'folder/roadmap'],
    ['Folder\\Roadmap#Plan', 'folder/roadmap'],
    ['  Mixed Case  ', 'mixed case'],
  ])('normalizes %s consistently', (input, expected) => {
    expect(normalizeWikiLinkLookupKey(input)).toBe(expected);
  });
});

describe('buildWikiLinkResolution', () => {
  it('uses visible paths when duplicate titles are not unique', () => {
    const resolution = buildWikiLinkResolution([
      { pageId: 'one', title: 'Plan', pagePath: 'Alpha/Plan' },
      { pageId: 'two', title: 'Plan', pagePath: 'Beta/Plan' },
      { pageId: 'three', title: 'Unique', pagePath: 'Alpha/Unique' },
    ]);

    expect(resolution.pageLookup.has('plan')).toBe(false);
    expect(resolution.pageLookup.get('alpha/plan')).toBe('one');
    expect(resolution.targetMarkdownPaths.get('one')).toBe('Alpha/Plan');
    expect(resolution.targetMarkdownPaths.get('three')).toBe('Unique');
  });
});
