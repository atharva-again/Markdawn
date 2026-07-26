import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const apiSourceDir = resolve(currentDir, '..');
const collabSourceDir = resolve(currentDir, '../../../collab/src');

function listApplicationTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    if (statSync(path).isDirectory()) return listApplicationTypeScriptFiles(path);
    if (extname(name) !== '.ts' || /\.(?:test|unit\.test)\.ts$/.test(name)) return [];
    return [path];
  });
}

function sqlTemplates(source: string): string[] {
  return Array.from(source.matchAll(/`([\s\S]*?)`/g), (match) => match[1] ?? '');
}

describe('monotonic page title writers', () => {
  it('increments title_revision in every raw SQL page-title update', () => {
    const files = [
      ...listApplicationTypeScriptFiles(apiSourceDir),
      ...listApplicationTypeScriptFiles(collabSourceDir),
    ];
    const titleUpdates = files.flatMap((path) =>
      sqlTemplates(readFileSync(path, 'utf8'))
        .filter((sql) => /\bupdate\s+"?pages"?\s+set\b/i.test(sql) && /\b"?title"?\s*=/i.test(sql))
        .map((sql) => ({ path, sql })),
    );

    expect(titleUpdates.length).toBeGreaterThan(0);
    for (const writer of titleUpdates) {
      expect(writer.sql, writer.path).toMatch(/\b"?title_revision"?\s*=/i);
    }
  });

  it('does not add an unchecked Drizzle page-title update', () => {
    const sources = listApplicationTypeScriptFiles(apiSourceDir).map((path) => ({
      path,
      source: readFileSync(path, 'utf8'),
    }));
    const drizzlePageUpdates = sources.flatMap(({ path, source }) =>
      Array.from(
        source.matchAll(/\.update\(pages\)([\s\S]{0,500}?)\.set\(([^;]{0,1000})/g),
        (match) => ({
          path,
          body: `${match[1] ?? ''}${match[2] ?? ''}`,
        }),
      ),
    );

    for (const writer of drizzlePageUpdates) {
      if (!/\btitle\s*:/.test(writer.body)) continue;
      expect(writer.body, writer.path).toMatch(/\btitleRevision\s*:/);
    }
  });
});
