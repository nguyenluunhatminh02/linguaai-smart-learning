import { test, expect } from '@playwright/test';

test('user logs in and redirects to dashboard', async ({ page }) => {
  await page.goto('/login');

  // Wait for React hydration and login form to load
  await page.waitForSelector('input[type="email"]');
  await page.waitForTimeout(2000);

  // Fill in login details
  await page.fill('input[type="email"]', 'nguyen.minh@linguaai.local');
  await page.fill('input[type="password"]', 'TestUser!2024');

  // Submit form
  await page.click('button[type="submit"]');

  // Verify redirect to dashboard
  await expect(page).toHaveURL(/.*dashboard/, { timeout: 20000 });
});
