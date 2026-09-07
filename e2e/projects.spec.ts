import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('项目中心关键旅程', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/projects');
  });

  test('里程碑：创建 → 完成 → 取消完成 → 删除', async ({ page }) => {
    // 进入第一个项目
    await page.locator('a[href^="/projects/"]').first().click();
    await expect(page).toHaveURL(/\/projects\//);

    const title = `E2E里程碑-${Date.now()}`;
    // 创建
    await page.getByRole('button', { name: '添加里程碑' }).click();
    await page.getByPlaceholder('例如：MVP 版本上线').fill(title);
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await expect(page.getByText(title)).toBeVisible();

    // 标记完成（划线态）
    const card = page.locator('div.group', { hasText: title }).first();
    await card.getByTitle('标记完成').click();
    await expect(page.getByText(title)).toHaveClass(/line-through/);

    // 取消完成
    await card.getByTitle('取消完成').click();
    await expect(page.getByText(title)).not.toHaveClass(/line-through/);

    // 删除
    await card.hover();
    await card.getByTitle('删除里程碑').click();
    await expect(page.getByText(title)).toHaveCount(0);
  });

  test('需求评论：发表并显示在列表', async ({ page }) => {
    await page.locator('a[href^="/projects/"]').first().click();
    // 打开第一个需求的编辑弹窗
    await page.getByTitle('编辑需求').first().click();
    await expect(page.getByText(/评论（/)).toBeVisible();

    const content = `E2E评论-${Date.now()}`;
    await page.getByPlaceholder('写下你的评论…').fill(content);
    await page.getByRole('button', { name: '发送' }).click();
    await expect(page.getByText(content)).toBeVisible();

    // 清理：删除该评论
    await page.getByText(content).hover();
    await page.getByTitle('删除评论').last().click();
    await expect(page.getByText(content)).toHaveCount(0);
  });

  test('看板列与任务卡片渲染', async ({ page }) => {
    await page.locator('a[href^="/projects/"]').first().click();
    // 展开第一个需求
    await page.locator('.card .flex.cursor-pointer').first().click();
    for (const col of ['待办', '进行中', '待评审', '已完成']) {
      await expect(page.getByText(col, { exact: true }).first()).toBeVisible();
    }
  });
});
