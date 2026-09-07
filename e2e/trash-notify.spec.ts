import { test, expect } from '@playwright/test';
import { login } from './helpers';

// 通过页面上下文（带登录 cookie）调 API 创建文档，保证用例稳定
async function createDocViaApi(page: import('@playwright/test').Page, title: string): Promise<string> {
  return page.evaluate(async (t) => {
    const res = await fetch('/api/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'personal', kind: 'doc', title: t }),
    });
    return (await res.json()).data.id as string;
  }, title);
}

test.describe('回收站旅程', () => {
  test('文档删除 → 回收站可见 → 恢复 → 再删除 → 彻底删除', async ({ page }) => {
    await login(page);

    const title = `E2E回收站-${Date.now()}`;
    await createDocViaApi(page, title);

    // 删除（软删除 → 回收站）
    await page.goto('/docs');
    const row = page.locator('tr', { hasText: title });
    await row.getByTitle('删除文档').click();
    await page.getByRole('button', { name: '确认删除' }).click();
    await expect(row).toHaveCount(0);

    // 回收站可见
    await page.goto('/trash');
    const trashRow = page.locator('div', { hasText: title }).filter({ has: page.getByRole('button', { name: '恢复' }) }).last();
    await expect(trashRow).toBeVisible();

    // 恢复
    await trashRow.getByRole('button', { name: '恢复' }).click();
    await expect(page.locator('div', { hasText: title }).filter({ hasText: '彻底删除' })).toHaveCount(0);

    // 回到文档列表确认已恢复
    await page.goto('/docs');
    await expect(page.locator('tr', { hasText: title })).toBeVisible();

    // 再次删除并彻底删除
    await page.locator('tr', { hasText: title }).getByTitle('删除文档').click();
    await page.getByRole('button', { name: '确认删除' }).click();
    await expect(page.locator('tr', { hasText: title })).toHaveCount(0);

    await page.goto('/trash');
    const trashRow2 = page.locator('div', { hasText: title }).filter({ has: page.getByRole('button', { name: '彻底删除' }) }).last();
    await trashRow2.getByRole('button', { name: '彻底删除' }).click();
    await page.getByRole('button', { name: '确认删除' }).click();
    await expect(page.locator('div', { hasText: title }).filter({ hasText: '恢复' })).toHaveCount(0);
  });
});

test.describe('通知中心', () => {
  test('铃铛打开通知面板', async ({ page }) => {
    await login(page);
    await page.getByTitle('通知').click();
    // 面板要么显示列表要么显示空态
    const empty = page.getByText('暂无通知');
    const anyItem = page.locator('text=/评论了|分配给你/').first();
    await expect(empty.or(anyItem)).toBeVisible();
  });
});
