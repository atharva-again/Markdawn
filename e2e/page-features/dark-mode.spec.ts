import { expect, test } from '@playwright/test';
import { createNewPage } from '../fixtures';

test.describe('Dark mode', () => {
  test('dark mode applies dark class to html', async ({ page }) => {
    await createNewPage(page);

    await page.evaluate(() => localStorage.setItem('markdawn-theme', 'dark'));
    await page.reload();
    await expect(page).toHaveURL(/\/[^/]+$/);

    await expect(page.locator('html')).toHaveClass(/dark/, { timeout: 10000 });
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  });

  test('light mode removes dark class from html', async ({ page }) => {
    await createNewPage(page);

    await page.evaluate(() => localStorage.setItem('markdawn-theme', 'light'));
    await page.reload();
    await expect(page).toHaveURL(/\/[^/]+$/);

    await expect(page.locator('html')).not.toHaveClass(/dark/, { timeout: 10000 });
  });
});
