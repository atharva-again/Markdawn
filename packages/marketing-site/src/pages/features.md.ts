import type { APIRoute } from 'astro';
import { FAQS, FEATURE_GROUPS, PRODUCT_SUMMARY } from '../data/features';
import { markdownResponse, renderMarkdownPage } from '../data/markdownPage';
import { APP_ORIGIN, DOCS_ORIGIN, SITE_ORIGIN } from '../data/siteConfig';

export const prerender = true;

const questions = FAQS.map(({ question, answer }) => `**${question}**\n\n${answer}`).join('\n\n');

const markdown = renderMarkdownPage({
  title: 'The collaborative knowledge base for humans and agents.',
  intro: [PRODUCT_SUMMARY],
  closing: 'Start in the browser. Add the CLI when you want a terminal in the loop.',
  sections: [
    ...FEATURE_GROUPS.map(({ title, body, docsLabel, docsUrl }) => ({
      title,
      body,
      linkLabel: `${docsLabel} →`,
      linkUrl: docsUrl,
    })),
  ],
  appendix: [{ title: 'Before You Start', body: questions }],
  footerTitle: 'Next step',
  footerLinks: [
    { label: 'Open Markdawn', url: APP_ORIGIN },
    { label: 'Read the CLI guide', url: `${DOCS_ORIGIN}/agents/markdawn-cli/` },
    { label: 'See who Markdawn is for', url: `${SITE_ORIGIN}/use-cases` },
  ],
});

export const GET: APIRoute = () => markdownResponse(markdown);
