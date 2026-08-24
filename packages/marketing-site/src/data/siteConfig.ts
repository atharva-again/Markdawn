export const SITE_ORIGIN = 'https://markdawn.space';
export const APP_ORIGIN = 'https://app.markdawn.space';
export const DOCS_ORIGIN = 'https://docs.markdawn.space';
export const GITHUB_URL = 'https://github.com/atharva-again/Markdawn';

export const SITE_PAGES = [
  { href: '/', label: 'Home', includeInNavigation: true },
  { href: '/features', label: 'Features', includeInNavigation: true },
  { href: '/use-cases', label: 'Use Cases', includeInNavigation: true },
] as const;

export const SITE_NAVIGATION = SITE_PAGES.filter(({ includeInNavigation }) => includeInNavigation);
