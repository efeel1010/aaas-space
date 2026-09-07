import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('工作台首页', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('首页核心区块完整渲染', async ({ page }) => {
    await expect(page.getByText('今天想在 Pulse Space 完成点什么？')).toBeVisible();
    // 全局搜索框
    await expect(page.getByPlaceholder('搜索文档、项目…')).toBeVisible();
    // 快捷入口
    for (const label of ['新建文档', '新建表格', '新建 Wiki', 'AI 助手']) {
      await expect(page.getByRole('button', { name: new RegExp(label) }).first()).toBeVisible();
    }
    // 统计卡
    for (const label of ['文档', '项目', '任务完成率', '团队']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    // 最近文档 Tab
    for (const tab of ['最近访问', '我创建的', '收藏']) {
      await expect(page.getByRole('button', { name: tab, exact: true }).first()).toBeVisible();
    }
    // 我的待办 + 项目进度
    await expect(page.getByText('我的待办')).toBeVisible();
    await expect(page.getByText('项目进度')).toBeVisible();
  });

  test('全局搜索能找到项目并跳转', async ({ page }) => {
    await page.getByPlaceholder('搜索文档、项目…').fill('金属');
    const result = page.getByRole('button', { name: /金属/ }).first();
    await expect(result).toBeVisible({ timeout: 5000 });
    await result.click();
    await expect(page).toHaveURL(/\/projects\//);
  });

  test('统计卡可点击跳转', async ({ page }) => {
    await page.getByRole('link', { name: /^\d+ 团队$/ }).click();
    await expect(page).toHaveURL('/teams');
  });
});
