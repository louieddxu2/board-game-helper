import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/core',
  testMatch: 'attribute-vote-style.spec.ts',
  use: {
    browserName: 'chromium',
    channel: process.platform === 'win32' ? 'chrome' : undefined,
  },
  reporter: 'list',
});
