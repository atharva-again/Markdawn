import { expect, test } from '@playwright/test';

test.describe('Folder management', () => {
  test('create a folder', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForURL(/\/$/, { timeout: 15000 });

    const folderBtn = page.getByTestId('new-folder-btn');
    await expect(folderBtn).toBeVisible({ timeout: 15_000 });
    await folderBtn.click();

    await expect(page.locator('text=New Folder').first()).toBeVisible({ timeout: 5000 });
  });

  test('folder appears in sidebar after creation', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForURL(/\/$/, { timeout: 15000 });

    const folderBtn = page.getByTestId('new-folder-btn');
    await expect(folderBtn).toBeVisible({ timeout: 15_000 });
    await folderBtn.click();
    await expect(page.locator('text=New Folder').first()).toBeVisible({ timeout: 5000 });

    await page.reload();
    await page.waitForURL(/\/$/);
    await expect(page.locator('text=New Folder').first()).toBeVisible({ timeout: 10000 });
  });
});
