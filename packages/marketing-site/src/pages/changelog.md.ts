import type { APIRoute } from 'astro';
import {
  CHANGELOG_DESCRIPTION,
  CHANGELOG_ENTRIES,
  CHANGELOG_INTRO,
  CHANGELOG_TITLE,
  formatChangelogDate,
} from '../data/changelog';
import { markdownResponse, renderMarkdownLink } from '../data/markdownPage';

export const prerender = true;

const renderedEntries = CHANGELOG_ENTRIES.map((entry) => {
  const links = entry.links.map((link) => `- ${renderMarkdownLink(link)}`).join('\n');
  return [
    `## ${entry.title}`,
    `_${formatChangelogDate(entry.date)}_`,
    entry.details.map((detail) => `- ${detail}`).join('\n'),
    links,
  ]
    .filter((block): block is string => Boolean(block))
    .join('\n\n');
}).join('\n\n');

const markdown = [
  `# ${CHANGELOG_TITLE}`,
  `> ${CHANGELOG_DESCRIPTION}`,
  CHANGELOG_INTRO,
  renderedEntries,
]
  .join('\n\n')
  .concat('\n');

export const GET: APIRoute = () => markdownResponse(markdown);
