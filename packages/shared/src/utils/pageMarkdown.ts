import { stringify } from 'yaml';
import { MAX_YDOC_BYTES } from '../constants/collaboration.js';
import type {
  ApplyExactEditsCommand,
  ExactEditCommandResult,
} from '../types/internalContentCommand.js';
import {
  MAX_EXACT_EDIT_REPLACEMENT_BYTES,
  MAX_EXACT_EDIT_VALIDATION_BYTES,
  MAX_EXACT_EDITS,
} from '../types/internalContentCommand.js';
import {
  parseMarkdownFrontmatter,
  UnsupportedMarkdownFrontmatterError,
} from './markdownFrontmatter.js';
import { normalizePageIcon } from './pageIcon.js';
import { validatePageProperties } from './pageProperties.js';

export type ParsedPageMarkdown = {
  body: string;
  properties: Record<string, unknown> | null;
  icon: string | null;
};

export type RequestedExactEdit = ApplyExactEditsCommand['edits'][number];

export type PageMarkdownErrorCode =
  | 'document_too_large'
  | 'edit_work_limit'
  | 'unsupported_frontmatter'
  | 'invalid_icon'
  | 'invalid_properties';

export class PageMarkdownError extends Error {
  constructor(
    readonly code: PageMarkdownErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

export function parsePageMarkdown(markdown: string): ParsedPageMarkdown {
  if (new TextEncoder().encode(markdown).byteLength > MAX_YDOC_BYTES) {
    throw new PageMarkdownError(
      'document_too_large',
      `Document must be ${MAX_YDOC_BYTES} bytes or less`,
    );
  }
  let parsed: ReturnType<typeof parseMarkdownFrontmatter>;
  try {
    parsed = parseMarkdownFrontmatter(normalizeLineEndings(markdown));
  } catch (error) {
    if (error instanceof UnsupportedMarkdownFrontmatterError) {
      throw new PageMarkdownError('unsupported_frontmatter', error.message);
    }
    throw error;
  }
  const properties = { ...parsed.frontmatter };
  const rawIcon = properties.icon;
  if (rawIcon !== undefined && rawIcon !== null && typeof rawIcon !== 'string') {
    throw new PageMarkdownError('invalid_icon', 'Frontmatter icon must be a string or null');
  }
  delete properties.icon;
  const propertyValue = Object.keys(properties).length > 0 ? properties : null;
  const propertyError = validatePageProperties(propertyValue);
  if (propertyError) throw new PageMarkdownError('invalid_properties', propertyError);
  return {
    body: parsed.body,
    properties: propertyValue,
    icon: normalizePageIcon(typeof rawIcon === 'string' ? rawIcon : null),
  };
}

export function composePageMarkdown(
  body: string,
  properties: Record<string, unknown> | null,
  icon: string | null,
): string {
  return serializeFrontmatter(properties, icon) + body;
}

/** Converts page properties and icon to YAML frontmatter. */
export function serializeFrontmatter(
  properties: Record<string, unknown> | null,
  icon: string | null,
): string {
  const data: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  if (icon) data.icon = icon;
  if (properties) {
    for (const [key, value] of Object.entries(properties)) {
      if (value !== undefined) data[key] = value;
    }
  }
  if (Object.keys(data).length === 0) return '';
  return `---\n${stringify(data, { lineWidth: 0, sortMapEntries: true })}---\n`;
}

export function applyExactEdits(markdown: string, edits: readonly RequestedExactEdit[]) {
  const encoder = new TextEncoder();
  const markdownBytes = encoder.encode(markdown).byteLength;
  const replacementBytes = edits.reduce(
    (total, edit) => total + encoder.encode(edit.newText).byteLength,
    0,
  );
  if (replacementBytes > MAX_EXACT_EDIT_REPLACEMENT_BYTES) {
    throw new PageMarkdownError(
      'document_too_large',
      `Replacement text must be ${MAX_EXACT_EDIT_REPLACEMENT_BYTES} bytes or less`,
    );
  }
  // Aggregate incompatibilities can require two full-document parses per
  // edit plus two fixed parses. Include all replacement bytes in the candidate
  // size estimate so the bound remains conservative for insertion-heavy edits.
  const candidateBytes = Math.max(markdownBytes + replacementBytes, 1);
  const validationCopies = Math.floor(MAX_EXACT_EDIT_VALIDATION_BYTES / candidateBytes);
  const maxEditsForDocument = Math.max(
    1,
    Math.min(MAX_EXACT_EDITS, Math.floor((validationCopies - 2) / 2)),
  );
  if (edits.length > maxEditsForDocument) {
    throw new PageMarkdownError(
      'edit_work_limit',
      `At most ${maxEditsForDocument} exact edits are allowed for this document size`,
    );
  }
  const positions = new Map<string, { start: number; end: number; edit: RequestedExactEdit }>();
  const results = new Map<string, ExactEditCommandResult>();
  for (const edit of edits) {
    if (!edit.oldText) {
      if (markdown !== '') {
        results.set(edit.id, { id: edit.id, status: 'conflict', reason: 'page_not_empty' });
        continue;
      }
      positions.set(edit.id, { start: 0, end: 0, edit });
      continue;
    }
    const start = markdown.indexOf(edit.oldText);
    if (start < 0) {
      results.set(edit.id, { id: edit.id, status: 'conflict', reason: 'old_text_not_found' });
      continue;
    }
    if (markdown.indexOf(edit.oldText, start + 1) >= 0) {
      results.set(edit.id, { id: edit.id, status: 'conflict', reason: 'old_text_not_unique' });
      continue;
    }
    positions.set(edit.id, { start, end: start + edit.oldText.length, edit });
  }

  const candidates = [...positions.values()];
  for (let left = 0; left < candidates.length; left += 1) {
    const a = candidates[left];
    if (!a) continue;
    for (let right = left + 1; right < candidates.length; right += 1) {
      const b = candidates[right];
      if (!b) continue;
      if (a.edit.oldText && b.edit.oldText && (a.end <= b.start || b.end <= a.start)) {
        continue;
      }
      results.set(a.edit.id, { id: a.edit.id, status: 'conflict', reason: 'overlapping_edit' });
      results.set(b.edit.id, { id: b.edit.id, status: 'conflict', reason: 'overlapping_edit' });
    }
  }

  const applicable = candidates
    .filter((candidate) => !results.has(candidate.edit.id))
    .sort((a, b) => a.start - b.start);

  type Candidate = (typeof applicable)[number];
  const replaceCandidates = (selected: readonly Candidate[]): string => {
    const chunks: string[] = [];
    let cursor = 0;
    for (const candidate of selected) {
      chunks.push(markdown.slice(cursor, candidate.start), candidate.edit.newText);
      cursor = candidate.end;
    }
    chunks.push(markdown.slice(cursor));
    return chunks.join('');
  };
  const parseCandidate = (candidateMarkdown: string): ParsedPageMarkdown | PageMarkdownError => {
    try {
      return parsePageMarkdown(candidateMarkdown);
    } catch (error) {
      // Invalid client-proposed Markdown is an expected per-edit outcome.
      // Unexpected parser failures are implementation errors and propagate.
      if (!(error instanceof PageMarkdownError)) throw error;
      return error;
    }
  };

  const independentlyValid: Candidate[] = [];
  for (const candidate of applicable) {
    const parsed = parseCandidate(replaceCandidates([candidate]));
    if (parsed instanceof PageMarkdownError) {
      results.set(candidate.edit.id, {
        id: candidate.edit.id,
        status: 'invalid',
        reason: parsed.message,
      });
    } else {
      independentlyValid.push(candidate);
    }
  }

  let accepted = independentlyValid;
  let updated = replaceCandidates(accepted);
  let parsedMarkdown = parseCandidate(updated);
  if (parsedMarkdown instanceof PageMarkdownError) {
    // Independently valid edits can still interact to produce an invalid
    // aggregate document. Retain the earliest compatible edits and attribute
    // only the candidate that makes the aggregate invalid.
    accepted = [];
    let acceptedParsed: ParsedPageMarkdown | null = null;
    for (const candidate of independentlyValid) {
      const candidateSet = [...accepted, candidate];
      const candidateParsed = parseCandidate(replaceCandidates(candidateSet));
      if (candidateParsed instanceof PageMarkdownError) {
        results.set(candidate.edit.id, {
          id: candidate.edit.id,
          status: 'invalid',
          reason: candidateParsed.message,
        });
      } else {
        accepted = candidateSet;
        acceptedParsed = candidateParsed;
      }
    }
    updated = replaceCandidates(accepted);
    parsedMarkdown = acceptedParsed ?? parsePageMarkdown(markdown);
  }
  for (const candidate of accepted) {
    results.set(candidate.edit.id, { id: candidate.edit.id, status: 'applied' });
  }
  const hasAppliedEdit = accepted.length > 0;
  return {
    markdown: hasAppliedEdit ? updated : markdown,
    parsedMarkdown: hasAppliedEdit ? parsedMarkdown : null,
    results: edits.map((edit) => {
      const result = results.get(edit.id);
      if (!result) throw new Error(`Missing exact-edit result for ${edit.id}`);
      return result;
    }),
  };
}
