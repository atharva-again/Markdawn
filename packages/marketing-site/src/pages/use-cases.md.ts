import type { APIRoute } from 'astro';
import { markdownResponse, renderMarkdownPage } from '../data/markdownPage';
import { USE_CASE_PAGE } from '../data/useCases';

export const prerender = true;

const markdown = renderMarkdownPage({
  title: USE_CASE_PAGE.title,
  intro: USE_CASE_PAGE.intro,
  closing: USE_CASE_PAGE.closing,
  sections: USE_CASE_PAGE.sections,
  appendix: [],
  footerTitle: USE_CASE_PAGE.footerTitle,
  footerLinks: USE_CASE_PAGE.footerLinks,
});

export const GET: APIRoute = () => markdownResponse(markdown);
