import { describe, expect, it } from 'vitest';
import { MAX_YDOC_BYTES } from '../constants/collaboration';
import { applyExactEdits, composePageMarkdown, parsePageMarkdown } from './pageMarkdown';

describe('page Markdown frontmatter serialization', () => {
  it('is canonical across object insertion orders', () => {
    expect(composePageMarkdown('Body', { z: { b: 2, a: 1 }, a: true }, null)).toBe(
      composePageMarkdown('Body', { a: true, z: { a: 1, b: 2 } }, null),
    );
  });

  it('round-trips the complete JSON-compatible property model', () => {
    const properties = JSON.parse(`{
      "nested": {"items": [{"name": "one", "flags": [true, false, null]}]},
      "__proto__": {"polluted": false},
      "multiline": "first line\\nsecond line\\n",
      "sensitive": ["true", "null", "01", "a: b", "#tag", "yes", "~"],
      "nullable": null
    }`) as Record<string, unknown>;

    const markdown = composePageMarkdown('Authored body', properties, 'pin');
    const parsed = parsePageMarkdown(markdown);

    expect(parsed.body).toBe('Authored body');
    expect(parsed.icon).toBe('pin');
    expect(parsed.properties).toEqual(properties);
    expect(Object.hasOwn(parsed.properties ?? {}, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('exact Markdown edits', () => {
  it('bounds validation work for large documents with many edits', () => {
    const markdown = 'x'.repeat(MAX_YDOC_BYTES);
    expect(() =>
      applyExactEdits(
        markdown,
        Array.from({ length: 100 }, (_, index) => ({
          id: `edit-${index}`,
          oldText: `missing-${index}`,
          newText: `replacement-${index}`,
        })),
      ),
    ).toThrow(expect.objectContaining({ code: 'edit_work_limit' }));
  });

  it('applies a valid body edit when an independent frontmatter edit is invalid', () => {
    const markdown = `---
category: notes
---
Original body`;
    const result = applyExactEdits(markdown, [
      { id: 'break-yaml', oldText: 'category: notes', newText: 'category: [unterminated' },
      { id: 'edit-body', oldText: 'Original body', newText: 'Updated body' },
    ]);

    expect(result.results).toEqual([
      expect.objectContaining({ id: 'break-yaml', status: 'invalid' }),
      { id: 'edit-body', status: 'applied' },
    ]);
    expect(result.markdown).toContain('category: notes');
    expect(result.markdown).toContain('Updated body');
    expect(result.parsedMarkdown?.body).toBe('Updated body');
  });
});
