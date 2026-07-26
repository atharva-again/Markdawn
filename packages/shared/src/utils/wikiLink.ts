/**
 * Canonical lookup key for authored wiki-link paths.
 *
 * Obsidian-style paths may use Windows separators, a leading relative/root
 * marker, an optional Markdown suffix, and a heading suffix. Every producer
 * and resolver must use this exact function so the trusted target does not
 * change during a connection-index rebuild.
 */
export function normalizeWikiLinkLookupKey(value: string): string {
  const path = value.split('#')[0] ?? '';
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\//, '')
    .replace(/\.md$/i, '')
    .toLowerCase();
}

export type WikiLinkLookupRow = {
  pageId: string;
  title: string;
  pagePath: string | null;
};

export type WikiLinkResolution = {
  pageLookup: Map<string, string>;
  targetMarkdownPaths: Map<string, string>;
};

/** Build unique authored-path bindings and safe render paths from visible pages. */
export function buildWikiLinkResolution(rows: readonly WikiLinkLookupRow[]): WikiLinkResolution {
  const candidates = new Map<string, Set<string>>();
  for (const row of rows) {
    for (const value of [row.title, row.pagePath]) {
      if (!value) continue;
      const key = normalizeWikiLinkLookupKey(value);
      if (!key) continue;
      const ids = candidates.get(key) ?? new Set<string>();
      ids.add(row.pageId);
      candidates.set(key, ids);
    }
  }

  const pageLookup = new Map<string, string>();
  for (const [key, ids] of candidates) {
    if (ids.size !== 1) continue;
    const pageId = ids.values().next().value;
    if (pageId) pageLookup.set(key, pageId);
  }

  const targetMarkdownPaths = new Map<string, string>();
  for (const row of rows) {
    const normalizedPageId = row.pageId.toLowerCase();
    const titleTarget = pageLookup.get(normalizeWikiLinkLookupKey(row.title));
    const path =
      titleTarget?.toLowerCase() === normalizedPageId ? row.title : (row.pagePath ?? row.title);
    targetMarkdownPaths.set(normalizedPageId, path);
  }
  return { pageLookup, targetMarkdownPaths };
}
