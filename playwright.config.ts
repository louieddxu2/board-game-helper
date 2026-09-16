import { defineConfig } from '@playwright/test';

const coreTestPort = Number(process.env.CORE_TEST_PORT ?? 4173);

export default defineConfig({
  testDir: './tests/core',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${coreTestPort}`,
    browserName: 'chromium',
    channel: process.platform === 'win32' ? 'chrome' : undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Trace and screenshot are sufficient here; recording video requires a
    // separately downloaded ffmpeg binary and must not weaken the release gate.
    video: 'off',
  },
  webServer: {
    command: 'npm run test:core:serve',
    url: `http://127.0.0.1:${coreTestPort}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
