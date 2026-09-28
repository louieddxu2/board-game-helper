import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/workspace-startup',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    browserName: 'chromium',
    channel: process.platform === 'win32' ? 'chrome' : undefined,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
