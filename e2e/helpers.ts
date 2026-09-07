import { test, expect, type Page } from '@playwright/test';

// 演示账号（来自 apps/api/src/db/seed.ts）
export const DEMO_EMAIL = 'alice@pulse.space';
export const DEMO_PASSWORD = 'Passw0rd123';

export async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(DEMO_EMAIL);
  await page.locator('input[type="password"]').fill(DEMO_PASSWORD);
  await page.locator('form button.btn-primary').click();
  await expect(page).toHaveURL('/', { timeout: 10_000 });
}
