// @vitest-environment node
import { expect, test } from 'vitest';
import { browserTestScope } from './release-test-scope.mjs';

test('back-end, data and documentation changes run only the gate browser tests', () => {
  expect(browserTestScope([
    'worker/scorepadApi.ts', 'worker/data/scorepadCatalog.ts', 'migrations/0130_game_catalog_scorepad_fields.sql',
    'docs/scorepad-integration.md', 'imports/planned/x/updates.sql', 'integration/game-name-identity.test.ts',
    'AGENTS.md', 'scripts/check-d1-boundary.mjs', 'scripts/scorepad-api.test.ts',
  ]).scope).toBe('gate');
  expect(browserTestScope([]).scope).toBe('gate');
});

test('page, shared, build and browser test changes run every browser test', () => {
  for (const file of [
    'src/pages/HomePage.tsx', 'src/shared/types.ts', 'src/styles/content-core.css', 'index.html', 'public/manifest.json',
    'vite.config.ts', 'vitest.config.ts', 'package.json', 'package-lock.json', 'tsconfig.json', 'wrangler.jsonc',
    'playwright.config.ts', 'tests/core/home-recovery.spec.ts', 'scripts/run-core-e2e.mjs', 'scripts/serve-core-test.mjs',
    'scripts/prepare-core-test.mjs', 'scripts/pwa-build.ts', 'scripts/release-test-scope.mjs',
  ]) {
    expect(browserTestScope(['worker/index.ts', file]), file).toEqual({ scope: 'all', reason: expect.stringContaining(file) });
  }
});

test('an unknown last deploy runs every browser test', () => {
  expect(browserTestScope(null).scope).toBe('all');
});
