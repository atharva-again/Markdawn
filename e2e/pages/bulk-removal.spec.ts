import { expect, test } from '@playwright/test';
import { API_URL, WEB_HOSTNAME } from '../fixtures';

type SetupResult = {
  cookie: string;
  userId: string;
};

type EntityResult = {
  id: string;
};

test('removes a mixed owned and shared selection with one progress state', async ({
  page,
  request,
  playwright,
}) => {
  test.setTimeout(60_000);
  const testToken = process.env.TEST_SETUP_TOKEN;
  if (!testToken) throw new Error('TEST_SETUP_TOKEN is required');

  const createUser = async (name: string): Promise<SetupResult> => {
    const response = await request.post(`${API_URL}/api/test/setup`, {
      data: { name },
      headers: { 'x-test-setup-token': testToken },
    });
    expect(response.ok()).toBeTruthy();
    return (await response.json()) as SetupResult;
  };

  const recipient = await createUser('Bulk Removal Recipient');
  const owner = await createUser('Bulk Removal Owner');
  const recipientEmail = `e2e-${recipient.userId.slice(0, 8)}@example.com`;

  const recipientApi = await playwright.request.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: {
      Cookie: `better-auth.session_token=${recipient.cookie}`,
    },
  });
  const ownerApi = await playwright.request.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: {
      Cookie: `better-auth.session_token=${owner.cookie}`,
    },
  });

  try {
    const unique = Date.now();
    const titles = {
      ownedPage: `Owned page ${unique}`,
      ownedFolder: `Owned folder ${unique}`,
      sharedPage: `Shared page ${unique}`,
      sharedFolder: `Shared folder ${unique}`,
    };

    const createEntity = async (
      api: typeof recipientApi,
      path: '/api/pages' | '/api/folders',
      data: { title: string } | { name: string },
    ): Promise<EntityResult> => {
      const response = await api.post(path, { data });
      expect(response.status()).toBe(201);
      return (await response.json()) as EntityResult;
    };

    await createEntity(recipientApi, '/api/pages', {
      title: titles.ownedPage,
    });
    await createEntity(recipientApi, '/api/folders', {
      name: titles.ownedFolder,
    });
    const sharedPage = await createEntity(ownerApi, '/api/pages', {
      title: titles.sharedPage,
    });
    const sharedFolder = await createEntity(ownerApi, '/api/folders', {
      name: titles.sharedFolder,
    });

    for (const [type, id] of [
      ['page', sharedPage.id],
      ['folder', sharedFolder.id],
    ] as const) {
      const response = await ownerApi.post(`/api/shares/entity/${type}/${id}/grants`, {
        data: { email: recipientEmail, permission: 'view' },
      });
      expect(response.ok()).toBeTruthy();
    }

    await page.context().clearCookies();
    await page.context().addCookies([
      {
        name: 'better-auth.session_token',
        value: recipient.cookie,
        domain: WEB_HOSTNAME,
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ]);

    await page.goto('/', { waitUntil: 'networkidle' });
    const sidebar = page.getByRole('region', { name: 'Sidebar' });
    for (const title of Object.values(titles)) {
      await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 15_000 });
      await expect(sidebar.getByText(title, { exact: true })).toBeVisible();
    }

    const ownedPageCard = page
      .getByRole('heading', { name: titles.ownedPage })
      .locator('xpath=ancestor::div[@role="button"][1]');
    await ownedPageCard.hover();
    await ownedPageCard.locator('button').first().click();
    await page.getByRole('button', { name: 'Select all', exact: true }).click();
    await expect(page.getByText('4 selected')).toBeVisible();

    const removalRequests: string[] = [];
    let resolveOwnedRemovals: (() => void) | undefined;
    const ownedRemovalsCompleted = new Promise<void>((resolve) => {
      resolveOwnedRemovals = resolve;
    });
    let resolveOwnedRefreshes: (() => void) | undefined;
    const ownedRefreshesCompleted = new Promise<void>((resolve) => {
      resolveOwnedRefreshes = resolve;
    });
    const completedOwnedRefreshes = new Set<string>();
    let releaseSharedRefresh: (() => void) | undefined;
    const sharedRefreshReleased = new Promise<void>((resolve) => {
      releaseSharedRefresh = resolve;
    });
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const isFinalRefresh = request.method() === 'GET' && removalRequests.length === 4;
      if (isFinalRefresh && pathname.startsWith('/api/shares/with-me')) {
        await sharedRefreshReleased;
        const response = await route.fetch();
        await route.fulfill({ response });
        return;
      }
      if (isFinalRefresh && (pathname === '/api/pages/tree' || pathname === '/api/folders/tree')) {
        const response = await route.fetch();
        await route.fulfill({ response });
        completedOwnedRefreshes.add(pathname);
        if (completedOwnedRefreshes.size === 2) resolveOwnedRefreshes?.();
        return;
      }

      const isEntityDelete =
        request.method() === 'DELETE' && /^\/api\/(pages|folders)\/[^/]+$/.test(pathname);
      const isEntityLeave =
        request.method() === 'POST' && /^\/api\/(pages|folders)\/[^/]+\/leave$/.test(pathname);
      if (!isEntityDelete && !isEntityLeave) {
        await route.continue();
        return;
      }

      const removalIndex = removalRequests.length;
      removalRequests.push(`${request.method()} ${pathname}`);
      await new Promise((resolve) => setTimeout(resolve, removalIndex < 2 ? 100 : 1_500));
      const response = await route.fetch();
      await route.fulfill({ response });
      if (removalRequests.length === 2) resolveOwnedRemovals?.();
    });

    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText(/2 items will be moved to Trash/)).toBeVisible();
    await expect(page.getByText(/2 items will be removed from your view/)).toBeVisible();
    await page.getByRole('button', { name: 'Remove items' }).click();

    await expect(page.getByText('Removing 4 items…')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove' })).toBeDisabled();

    await ownedRemovalsCompleted;
    await page.waitForTimeout(500);
    await expect(page.getByText('Removing 4 items…')).toBeVisible();
    for (const title of Object.values(titles)) {
      await expect(page.getByRole('heading', { name: title })).toBeVisible();
      await expect(sidebar.getByText(title, { exact: true })).toBeVisible();
    }

    // The owned-item queries finish before the deliberately delayed shared-item
    // queries. The dashboard and sidebar must keep showing the original complete
    // list instead of exposing that partial final refresh.
    await ownedRefreshesCompleted;
    await expect(page.getByText('Removing 4 items…')).toBeVisible();
    for (const title of Object.values(titles)) {
      await expect(page.getByRole('heading', { name: title })).toBeVisible();
      await expect(sidebar.getByText(title, { exact: true })).toBeVisible();
    }

    releaseSharedRefresh?.();

    await expect(
      page.getByText('Moved 2 items to Trash; removed 2 items from your view'),
    ).toBeVisible({ timeout: 15_000 });
    for (const title of Object.values(titles)) {
      await expect(page.getByRole('heading', { name: title })).toHaveCount(0);
      await expect(sidebar.getByText(title, { exact: true })).toHaveCount(0);
    }
    expect(removalRequests).toHaveLength(4);
    expect(removalRequests.filter((entry) => entry.endsWith('/leave'))).toHaveLength(2);

    await page.unroute('**/api/**');
    const failedPage = await createEntity(recipientApi, '/api/pages', {
      title: `Failed removal ${unique}`,
    });
    await createEntity(recipientApi, '/api/pages', {
      title: `Successful removal ${unique}`,
    });
    await page.reload({ waitUntil: 'networkidle' });

    const failedCard = page
      .getByRole('heading', { name: `Failed removal ${unique}` })
      .locator('xpath=ancestor::div[@role="button"][1]');
    await failedCard.hover();
    await failedCard.locator('button').first().click();
    await page.getByRole('button', { name: 'Select all', exact: true }).click();
    await expect(page.getByText('2 selected')).toBeVisible();

    await page.route(`**/api/pages/${failedPage.id}`, async (route) => {
      if (route.request().method() !== 'DELETE') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Expected removal failure' }),
      });
    });

    await page.getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('button', { name: 'Remove items' }).click();

    await expect(page.getByText('1 removed, 1 failed')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('1 selected')).toBeVisible();
    await expect(page.getByRole('heading', { name: `Failed removal ${unique}` })).toBeVisible();
    await expect(page.getByRole('heading', { name: `Successful removal ${unique}` })).toHaveCount(
      0,
    );
  } finally {
    await recipientApi.dispose();
    await ownerApi.dispose();
  }
});
