export type RichTextSegment = { kind: 'text'; value: string } | { kind: 'code'; value: string };

export type RichText = readonly RichTextSegment[];

export const richText = (...segments: RichTextSegment[]): RichText => segments;

export const richTextToPlainText = (segments: RichText): string =>
  segments.map(({ value }) => value).join('');

export const richTextToMarkdown = (segments: RichText): string =>
  segments
    .map((segment) => {
      if (segment.kind === 'code') {
        return `\`${segment.value.replaceAll('`', '\\`')}\``;
      }

      return segment.value;
    })
    .join('');
