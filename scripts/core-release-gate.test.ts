// @vitest-environment node

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

describe('core release gate wiring', () => {
  test('runs the blocking core suite before deployment and smoke after deployment', () => {
    const deploySource = readFileSync('scripts/deploy-with-migration-check.mjs', 'utf8');
    const releaseGate = deploySource.indexOf("execSync('npm run test:release'");
    const cloudflareAuth = deploySource.indexOf('await ensureCloudflareAuth()');
    const deploy = deploySource.indexOf("execSync('npm run deploy:code'");
    const productionSmoke = deploySource.indexOf("execSync('npm run smoke:production'");
    const successRecord = deploySource.indexOf('recordSuccessfulDeploy(deployingSha)');

    expect(releaseGate).toBeGreaterThan(-1);
    expect(releaseGate).toBeLessThan(cloudflareAuth);
    expect(deploy).toBeGreaterThan(cloudflareAuth);
    expect(productionSmoke).toBeGreaterThan(deploy);
    expect(successRecord).toBeGreaterThan(productionSmoke);
  });

  test('release suite includes complete tests, typecheck and browser E2E', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
    expect(packageJson.scripts['test:release']).toContain('npm test');
    expect(packageJson.scripts['test:release']).toContain('npm run typecheck');
    expect(packageJson.scripts['test:release']).toContain('npm run test:core:e2e');
    expect(packageJson.scripts['test:core:e2e']).toContain('npm run build');
    expect(packageJson.scripts['test:core:e2e']).toContain('playwright test');
  });
});
