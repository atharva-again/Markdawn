import path from 'node:path';
import { expect, test as setup } from '@playwright/test';
import { API_URL, WEB_HOSTNAME } from './fixtures';

const authFile = path.join(__dirname, 'playwright/.auth/user.json');

setup('authenticate', async ({ page, request }) => {
  // Create a test user and session via the API's protected test setup endpoint.
  // The API and Playwright process must use the same explicit token.
  const testToken = process.env.TEST_SETUP_TOKEN;
  if (!testToken) {
    throw new Error('TEST_SETUP_TOKEN is required for end-to-end tests');
  }
  const headers: Record<string, string> = {
    'x-test-setup-token': testToken,
  };

  const res = await request.post(`${API_URL}/api/test/setup`, {
    data: { name: 'Playwright Test User' },
    headers,
  });
  expect(res.ok()).toBeTruthy();

  const { cookie } = (await res.json()) as { cookie: string };

  await page.context().addCookies([
    {
      name: 'better-auth.session_token',
      value: cookie,
      domain: WEB_HOSTNAME,
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax' as const,
    },
  ]);

  await page.goto('/', { waitUntil: 'networkidle' });
  expect(new URL(page.url()).pathname).toBe('/');
  await page.context().storageState({ path: authFile });
});
