const configuredFrontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const frontendUrl = new URL(configuredFrontendUrl);

if (frontendUrl.protocol !== 'http:' && frontendUrl.protocol !== 'https:') {
  throw new Error('FRONTEND_URL must use http or https');
}
if (frontendUrl.search || frontendUrl.hash) {
  throw new Error('FRONTEND_URL must not include a query string or fragment');
}

const frontendPath = frontendUrl.pathname.replace(/\/+$/, '');

export const publicFrontendUrl = frontendUrl.toString().replace(/\/$/, '');

export function buildPublicWebUrl(pathname: string): string {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const url = new URL(frontendUrl);
  url.pathname = `${frontendPath}${normalizedPath}` || '/';
  return url.toString();
}
