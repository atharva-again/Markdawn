import type { APIRoute } from 'astro';
import { markdownResponse, renderMarkdownPage } from '../data/markdownPage';
import { APP_ORIGIN, SITE_ORIGIN } from '../data/siteConfig';
import { USE_CASES } from '../data/useCases';

export const prerender = true;

const markdown = renderMarkdownPage({
  title: 'Built for people and agents.',
  intro: [
    'A collaborative markdown knowledge base for individuals, teams, developers, writers, researchers, and AI-assisted workflows. Write, organize, and share the same pages across the browser, terminal, and API.',
  ],
  closing: 'Start with a page, bring in your existing notes, or share a workspace with your team.',
  sections: USE_CASES.map(({ title, body, docsLabel, docsUrl }) => ({
    title,
    body,
    linkLabel: `${docsLabel} →`,
    linkUrl: docsUrl,
  })),
  appendix: [],
  footerTitle: 'Next step',
  footerLinks: [
    { label: 'Open Markdawn', url: APP_ORIGIN },
    { label: 'Read the features', url: `${SITE_ORIGIN}/features` },
  ],
});

export const GET: APIRoute = () => markdownResponse(markdown);
