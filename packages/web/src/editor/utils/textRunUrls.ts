import type { MarkType, Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { findHttpUrls } from '../../utils/url';

export interface TextRunSegment {
  from: number;
  node: ProseMirrorNode;
}

export interface TextRunUrlRange {
  from: number;
  href: string;
  to: number;
}

/** True when every inline node in a candidate range can receive a new link mark. */
export function isEligibleAutolinkRange(
  doc: ProseMirrorNode,
  from: number,
  to: number,
  linkMarkType: MarkType,
): boolean {
  let eligible = from < to;
  let hasText = false;
  doc.nodesBetween(from, to, (node) => {
    if (!node.isText) {
      if (node.isInline) eligible = false;
      return !node.isInline;
    }
    hasText = true;
    if (node.marks.some((mark) => mark.type === linkMarkType || mark.type.spec.code)) {
      eligible = false;
      return false;
    }
    return true;
  });
  return eligible && hasText;
}

export function findHttpUrlsInTextRun(nodes: readonly ProseMirrorNode[], context = '') {
  return findHttpUrls(`${context}${nodes.map((node) => node.text ?? '').join('')}`).flatMap(
    (match) => {
      if (match.from < context.length) return [];
      return [
        {
          ...match,
          from: match.from - context.length,
          to: match.to - context.length,
        },
      ];
    },
  );
}

function getPositionAtTextOffset(segments: readonly TextRunSegment[], offset: number): number {
  let runOffset = 0;
  for (const segment of segments) {
    const textLength = segment.node.text?.length ?? 0;
    const segmentEnd = runOffset + textLength;
    if (offset <= segmentEnd) return segment.from + offset - runOffset;
    runOffset = segmentEnd;
  }
  throw new Error(`Text-run offset ${offset} exceeds its segments`);
}

/** Maps canonical URL matches in a contiguous text run back to document positions. */
export function getHttpUrlRangesInTextRun(
  segments: readonly TextRunSegment[],
  context = '',
): TextRunUrlRange[] {
  if (segments.length === 0) return [];
  const matches = findHttpUrlsInTextRun(
    segments.map((segment) => segment.node),
    context,
  );
  return matches.map((match) => ({
    from: getPositionAtTextOffset(segments, match.from),
    href: match.href,
    to: getPositionAtTextOffset(segments, match.to),
  }));
}
