import { test, expect } from '@playwright/test';

test('user navigates to flashcards and can view decks', async ({ page }) => {
  test.setTimeout(60000);

  // Login first
  await page.goto('/login');
  await page.waitForSelector('input[type="email"]');
  await page.waitForTimeout(2000);
  
  await page.fill('input[type="email"]', 'nguyen.minh@linguaai.local');
  await page.fill('input[type="password"]', 'TestUser!2024');
  await page.click('button[type="submit"]');

  // Verify dashboard redirect
  await expect(page).toHaveURL(/.*dashboard/, { timeout: 20000 });

  // Navigate to flashcards page
  await page.goto('/flashcards');

  // Check that the flashcards header/deck list loads
  await expect(page.locator('h1')).toContainText(/Flashcard/i, { timeout: 20000 });
});
