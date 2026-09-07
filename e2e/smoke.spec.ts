import { expect, test } from '@playwright/test';
test('application shell loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();
});

test('Appwrite auth callback routes fail closed when tokens are missing', async ({ page }) => {
  await page.goto('/auth/verify-email');
  await expect(page.getByRole('heading', { name: 'Email verification' })).toBeVisible();
  await expect(page.getByText(/verification link is incomplete/i)).toBeVisible();

  await page.goto('/auth/reset-password');
  await expect(page.getByRole('heading', { name: 'Password recovery' })).toBeVisible();
  await expect(page.getByText(/recovery link is incomplete/i)).toBeVisible();
});
