import type { APIRoute } from 'astro';
import { markdownResponse, renderMarkdownPage } from '../data/markdownPage';
import { PRICING_PAGE } from '../data/pricing';

export const prerender = true;

const markdown = renderMarkdownPage({
  title: PRICING_PAGE.title,
  intro: PRICING_PAGE.intro,
  closing: PRICING_PAGE.closing,
  sections: PRICING_PAGE.sections,
  appendix: [],
  footerTitle: PRICING_PAGE.footerTitle,
  footerLinks: PRICING_PAGE.footerLinks,
});

export const GET: APIRoute = () => markdownResponse(markdown);
