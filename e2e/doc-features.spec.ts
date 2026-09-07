import { test, expect } from '@playwright/test';
import { login } from './helpers';

// 通过页面上下文调 API（带登录 cookie）
async function api(page: import('@playwright/test').Page, method: string, path: string, body?: unknown) {
  return page.evaluate(
    async ([m, p, b]) => {
      const res = await fetch(`/api${p}`, {
        method: m,
        headers: { 'Content-Type': 'application/json' },
        body: b ? JSON.stringify(b) : undefined,
      });
      return res.json();
    },
    [method, path, body] as const,
  );
}

test.describe('文档分享', () => {
  test('开启只读分享 → 匿名可访问 → 关闭后 404', async ({ page, browser }) => {
    await login(page);
    const title = `E2E分享-${Date.now()}`;
    const doc = await api(page, 'POST', '/documents', { scope: 'personal', kind: 'doc', title, content: '# 分享内容验证\n\n大家好' }) as { data: { id: string } };
    const docId = doc.data.id;

    // 编辑器内开启分享
    await page.goto(`/docs/${docId}`);
    await page.getByTitle('分享').click();
    await page.getByRole('button', { name: '开启（可阅读）' }).click();
    await expect(page.getByText(/\/share\//)).toBeVisible();
    const linkText = await page.locator('p.break-all').textContent();
    const token = linkText!.split('/share/')[1].trim();

    // 匿名上下文访问分享页
    const anon = await browser.newContext();
    const anonPage = await anon.newPage();
    await anonPage.goto(`/share/${token}`);
    await expect(anonPage.getByRole('heading', { name: title })).toBeVisible();
    await expect(anonPage.getByText('大家好')).toBeVisible();
    await expect(anonPage.getByText('只读')).toBeVisible();

    // 关闭分享后匿名访问 404（弹层仍处于打开状态，直接点关闭）
    await page.getByRole('button', { name: '关闭分享' }).click();
    await anonPage.reload();
    await expect(anonPage.getByText('分享不存在或已关闭')).toBeVisible();
    await anon.close();

    // 清理
    await api(page, 'DELETE', `/documents/${docId}`);
    await api(page, 'DELETE', `/documents/${docId}/permanent`);
  });
});

test.describe('模板中心', () => {
  test('另存为模板 → 从模板新建', async ({ page }) => {
    await login(page);
    const title = `E2E模板源-${Date.now()}`;
    const doc = await api(page, 'POST', '/documents', { scope: 'personal', kind: 'doc', title, content: '# 周报\n\n## 本周进展\n' }) as { data: { id: string } };

    // 通过 API 另存为模板（编辑器入口已在 UI 中，这里验证数据链路）
    await api(page, 'POST', `/documents/${doc.data.id}/save-as-template`, { title: 'E2E周报模板' });

    // 文档列表 → 新建 → 从模板新建 → 使用
    await page.goto('/docs');
    await page.getByRole('button', { name: /新建/ }).first().click();
    await page.getByRole('button', { name: '从模板新建' }).click();
    const row = page.locator('div.group', { hasText: 'E2E周报模板' });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: '使用' }).click();
    await page.waitForURL(/\/docs\//);
    await expect(page.locator('.doc-title-input')).toHaveValue('E2E周报模板');

    // 清理：删模板 + 两个文档
    const tpls = await api(page, 'GET', '/documents/templates') as { data: { id: string; title: string }[] };
    const tpl = tpls.data.find((t) => t.title === 'E2E周报模板');
    if (tpl) await api(page, 'DELETE', `/documents/templates/${tpl.id}`);
    const url = page.url();
    const newDocId = url.split('/docs/')[1];
    for (const id of [doc.data.id, newDocId]) {
      await api(page, 'DELETE', `/documents/${id}`);
      await api(page, 'DELETE', `/documents/${id}/permanent`);
    }
  });
});

test.describe('版本对比', () => {
  test('版本面板出现对比按钮并展示 diff', async ({ page }) => {
    await login(page);
    const title = `E2E对比-${Date.now()}`;
    const doc = await api(page, 'POST', '/documents', { scope: 'personal', kind: 'doc', title, content: '第一版内容' }) as { data: { id: string } };
    const docId = doc.data.id;
    // 修改两次产生两个历史版本（最新版本与当前内容一致，对比选次新版本才有差异）
    await api(page, 'PATCH', `/documents/${docId}`, { content: '第二版内容' });
    await api(page, 'PATCH', `/documents/${docId}`, { content: '第三版内容，有修改' });

    await page.goto(`/docs/${docId}`);
    await page.getByTitle('版本历史').click();
    await page.getByTitle('与当前内容对比').nth(1).click();
    await expect(page.getByText(/版本对比/)).toBeVisible();
    await expect(page.getByText('+1 行新增')).toBeVisible();
    await expect(page.getByText('-1 行删除')).toBeVisible();
    await page.keyboard.press('Escape');

    await api(page, 'DELETE', `/documents/${docId}`);
    await api(page, 'DELETE', `/documents/${docId}/permanent`);
  });
});
