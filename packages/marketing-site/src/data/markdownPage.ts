import type { APIRoute } from 'astro';
import { type RichText, richTextToMarkdown } from './richText';

export interface MarkdownSection {
  title: string;
  body: RichText;
  linkLabel: string;
  linkUrl: string;
}

export interface MarkdownLink {
  label: string;
  url: string;
}

export interface MarkdownAppendix {
  title: string;
  body: string;
}

export interface MarkdownPageDefinition {
  title: string;
  intro: readonly string[];
  closing: string;
  sections: readonly MarkdownSection[];
  appendix: readonly MarkdownAppendix[];
  footerTitle: string;
  footerLinks: readonly MarkdownLink[];
}

export const renderMarkdownPage = ({
  title,
  intro,
  closing,
  sections,
  appendix,
  footerTitle,
  footerLinks,
}: MarkdownPageDefinition): string => {
  const renderedSections = sections
    .map(
      ({ title: sectionTitle, body, linkLabel, linkUrl }) => `## ${sectionTitle}

${richTextToMarkdown(body)}

[${linkLabel}](${linkUrl})`,
    )
    .join('\n\n');
  const renderedAppendix = appendix
    .map(({ title: appendixTitle, body }) => `## ${appendixTitle}\n\n${body}`)
    .join('\n\n');
  const renderedFooterLinks = footerLinks
    .map(({ label, url }) => `- [${label}](${url})`)
    .join('\n');

  return [
    `# ${title}`,
    intro.map((line) => `> ${line}`).join('\n\n'),
    renderedSections,
    renderedAppendix,
    closing,
    `## ${footerTitle}`,
    renderedFooterLinks,
  ]
    .filter((block) => block.length > 0)
    .join('\n\n')
    .concat('\n');
};

export const markdownResponse = (markdown: string): ReturnType<APIRoute> =>
  new Response(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
    },
  });
