import { parseDocument } from 'yaml';

export interface MarkdownFrontmatterResult {
  frontmatter: Record<string, unknown>;
  body: string;
  tags: string[];
}

export class UnsupportedMarkdownFrontmatterError extends Error {
  constructor(lineNumber: number, reason: string) {
    super(`Unsupported YAML frontmatter on line ${lineNumber}: ${reason}`);
    this.name = 'UnsupportedMarkdownFrontmatterError';
  }
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function isPlainRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sourceLineForKey(source: string, key: string): number {
  const index = source
    .split(/\r?\n/)
    .findIndex((line) => line.match(/^([^:#]+):/)?.[1]?.trim() === key);
  return index < 0 ? 1 : index + 2;
}

function toJsonValue(value: unknown, ancestors = new Set<object>()): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    throw new UnsupportedMarkdownFrontmatterError(1, 'values must be JSON-compatible');
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new UnsupportedMarkdownFrontmatterError(1, 'circular values are not supported');
    }
    ancestors.add(value);
    const result = value.map((item) => toJsonValue(item, ancestors));
    ancestors.delete(value);
    return result;
  }
  if (typeof value === 'object') {
    if (!isPlainRecord(value)) {
      throw new UnsupportedMarkdownFrontmatterError(1, 'values must be JSON-compatible');
    }
    if (ancestors.has(value)) {
      throw new UnsupportedMarkdownFrontmatterError(1, 'circular values are not supported');
    }
    ancestors.add(value);
    const result: { [key: string]: JsonValue } = Object.create(null);
    for (const [key, item] of Object.entries(value)) result[key] = toJsonValue(item, ancestors);
    ancestors.delete(value);
    return result;
  }
  throw new UnsupportedMarkdownFrontmatterError(1, 'values must be JSON-compatible');
}

function parseFrontmatterMapping(source: string): Record<string, JsonValue> {
  const document = parseDocument(source, {
    prettyErrors: false,
    uniqueKeys: true,
  });
  const parseIssue = document.errors[0] ?? document.warnings[0];
  if (parseIssue) {
    throw new UnsupportedMarkdownFrontmatterError(
      (parseIssue.linePos?.[0]?.line ?? 0) + 1,
      parseIssue.message,
    );
  }

  let parsed: unknown;
  try {
    parsed = document.toJS({ maxAliasCount: 100 });
  } catch (error) {
    throw new UnsupportedMarkdownFrontmatterError(
      1,
      error instanceof Error ? error.message : String(error),
    );
  }
  if (parsed === null) return {};
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new UnsupportedMarkdownFrontmatterError(1, 'frontmatter must be a top-level mapping');
  }

  const normalized = toJsonValue(parsed);
  if (Array.isArray(normalized) || normalized === null || typeof normalized !== 'object') {
    throw new UnsupportedMarkdownFrontmatterError(1, 'frontmatter must be a top-level mapping');
  }
  return normalized;
}

function readTagValues(value: unknown, key: 'tag' | 'tags', source: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) && typeof value !== 'string') {
    throw new UnsupportedMarkdownFrontmatterError(
      sourceLineForKey(source, key),
      `${key} must be a string or an array of strings`,
    );
  }
  const values = Array.isArray(value) ? value : value.split(',');
  if (values.some((tag) => typeof tag !== 'string')) {
    throw new UnsupportedMarkdownFrontmatterError(
      sourceLineForKey(source, key),
      `${key} must contain only strings`,
    );
  }
  return values as string[];
}

/** Parse YAML frontmatter into JSON-compatible page properties. */
export function parseMarkdownFrontmatter(content: string): MarkdownFrontmatterResult {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    if (/^---\r?\n/.test(content)) {
      throw new UnsupportedMarkdownFrontmatterError(1, 'closing --- delimiter is missing');
    }
    return {
      frontmatter: {},
      body: content,
      tags: [],
    };
  }

  const source = match[1] ?? '';
  const frontmatter = parseFrontmatterMapping(source);
  const tags = [
    ...readTagValues(frontmatter.tags, 'tags', source),
    ...readTagValues(frontmatter.tag, 'tag', source),
  ]
    .map((tag) => tag.trim().replace(/^#+/, ''))
    .filter(Boolean);
  const uniqueTags = [...new Set(tags)];
  if (Object.hasOwn(frontmatter, 'tags') || Object.hasOwn(frontmatter, 'tag')) {
    frontmatter.tags = uniqueTags;
  }
  delete frontmatter.tag;

  return {
    frontmatter,
    body: content.slice(match[0].length),
    tags: uniqueTags,
  };
}

export function extractInlineTags(content: string): string[] {
  const tags = new Set<string>();
  const hexOnly = /^[0-9a-f]+$/i;
  for (const match of content.matchAll(/(?:^|\s)#([a-zA-Z0-9_\-/]+)/g)) {
    const rawTag = match[1];
    if (!rawTag) continue;
    if (hexOnly.test(rawTag) && [3, 6, 8].includes(rawTag.length)) continue;
    tags.add(rawTag.toLowerCase());
  }
  return [...tags];
}
