import type { APIRoute } from 'astro';
import { FAQS, FEATURE_GROUPS, PRODUCT_SUMMARY } from '../data/features';
import { markdownResponse, renderMarkdownPage } from '../data/markdownPage';
import { DOCS_ORIGIN } from '../data/siteConfig';

export const prerender = true;

const questions = FAQS.map(({ question, answer }) => `**${question}**\n\n${answer}`).join('\n\n');

const markdown = renderMarkdownPage({
  title: 'The collaborative knowledge base for humans and agents.',
  intro: [PRODUCT_SUMMARY],
  closing: 'Start in the browser. Add the CLI when you want a terminal in the loop.',
  sections: [
    ...FEATURE_GROUPS.map(({ id, title, body, link }) => ({
      id,
      title,
      body,
      link,
    })),
  ],
  appendix: [{ title: 'Before You Start', body: questions }],
  footerTitle: 'Next step',
  footerLinks: [
    { kind: 'app', label: 'Open Markdawn' },
    { kind: 'external', label: 'Read The CLI Guide', url: `${DOCS_ORIGIN}/agents/markdawn-cli/` },
    { kind: 'internal', label: 'See Who Markdawn Is For', path: '/use-cases' },
  ],
});

export const GET: APIRoute = () => markdownResponse(markdown);
