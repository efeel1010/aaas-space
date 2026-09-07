import { defineConfig, devices } from '@playwright/test';

// 关键旅程 E2E：依赖本地服务 web(5183) + api(3101) + Postgres(5434)
// 启动：pnpm dev:api / pnpm dev:web 后执行 pnpm test:e2e
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  retries: 1,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5183',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
