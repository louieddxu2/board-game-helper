// @vitest-environment node

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { execSync, execFileSync, ensureCloudflareAuth, listPendingRemoteMigrations, writeFileSync, rmSync, changedFilesSinceLastDeploy } = vi.hoisted(() => ({
  execSync: vi.fn(), execFileSync: vi.fn(), ensureCloudflareAuth: vi.fn(),
  listPendingRemoteMigrations: vi.fn(), writeFileSync: vi.fn(), rmSync: vi.fn(), changedFilesSinceLastDeploy: vi.fn(),
}));
vi.mock('child_process', () => ({ execSync, execFileSync }));
vi.mock('fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs')>(), mkdirSync: vi.fn(), writeFileSync, rmSync,
}));
vi.mock('./cloudflare-login.mjs', () => ({ ensureCloudflareAuth }));
vi.mock('./d1-migration-list.mjs', () => ({ listPendingRemoteMigrations }));
vi.mock('./check-d1-trigger-fanout.mjs', () => ({ checkD1TriggerFanout: vi.fn() }));
vi.mock('./release-test-scope.mjs', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(), changedFilesSinceLastDeploy,
}));

const runProductionRelease = () => {
  // @ts-expect-error The release entry point is executable plain JavaScript.
  return import('./deploy-with-migration-check.mjs');
};

describe('production release execution', () => {
  const sha = 'a'.repeat(40);
  const commands: string[] = [];
  const releaseTests = 'npm run test:release';
  const migrate = 'npm run db:migrate:remote';
  const deploy = 'npm run deploy:code';
  const smoke = 'npm run smoke:production';
  const workspaceRemoval = '0116_remove_workspace_backup_coordination.sql';
  let failCommand: string | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('CI', 'true');
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    commands.length = 0;
    failCommand = undefined;
    listPendingRemoteMigrations.mockReturnValue([]);
    ensureCloudflareAuth.mockImplementation(async () => { commands.push('auth'); });
    writeFileSync.mockImplementation(() => { commands.push('record'); });
    execSync.mockImplementation((command: string) => {
      if (command === releaseTests || command === migrate || command === deploy || command === smoke) {
        commands.push(command);
        if (command === failCommand) throw new Error('injected failure');
        return '';
      }
      if (command === 'git rev-parse HEAD' || command === 'git rev-parse HEAD^') return sha;
      if (command.startsWith('git merge-base --is-ancestor ') || command.startsWith('git diff ')) return '';
      if (command.includes('wrangler secret list')) return JSON.stringify([{ name: 'EMAIL_HASH_SECRET' }]);
      throw new Error(`Unexpected command: ${command}`);
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test.each([
    { name: 'ordinary migration', pending: ['0124_stop_provisioning_unrated_attribute_scores.sql'],
      expected: [releaseTests, 'auth', migrate, deploy, smoke, 'record'] },
    { name: 'deferred Workspace removal', pending: [workspaceRemoval],
      expected: [releaseTests, 'auth', deploy, smoke, migrate, 'record'] },
  ])('executes the release in order with $name', async ({ pending, expected }) => {
    listPendingRemoteMigrations.mockReturnValue(pending);
    await runProductionRelease();
    await vi.waitFor(() => expect(writeFileSync).toHaveBeenCalledOnce());
    expect(commands).toEqual(expected);
    expect(writeFileSync).toHaveBeenCalledWith('.wrangler/last-successful-deploy-sha', `${sha}\n`, 'utf8');
    expect(process.exit).not.toHaveBeenCalled();
  });

  test.each([
    { failure: releaseTests, expected: [releaseTests] },
    { failure: smoke, expected: [releaseTests, 'auth', deploy, smoke] },
    { failure: migrate, expected: [releaseTests, 'auth', deploy, smoke, migrate] },
  ])('stops on $failure failure', async ({ failure, expected }) => {
    listPendingRemoteMigrations.mockReturnValue([workspaceRemoval]);
    failCommand = failure;
    await runProductionRelease();
    await vi.waitFor(() => expect(process.exit).toHaveBeenCalledExactlyOnceWith(1));
    expect(commands).toEqual(expected);
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});

describe('core release gate wiring', () => {
  test('release suite includes complete tests, typecheck and browser E2E', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
    expect(packageJson.scripts['test:release'].split(/\s*&&\s*/u)).toEqual(expect.arrayContaining([
      'npm run check:d1-fanout', 'npm test', 'npm run typecheck', 'npm run test:core:e2e',
    ]));
    expect(packageJson.scripts['test:core:e2e']).toBe('node scripts/run-core-e2e.mjs');
    expect(packageJson.scripts['test:core:prepare']).toContain('prepare-core-test');
    expect(packageJson.scripts['test:migrations:fresh']).toContain('CORE_TEST_DATABASE_MODE=fresh');
  });

  test('browser release runner builds, prepares a local database and runs both suites', async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('RELEASE_GATE_ONLY', '0');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      execSync.mockImplementation(() => '');
      execFileSync.mockImplementation(() => '');
      changedFilesSinceLastDeploy.mockReturnValue(['src/pages/HomePage.tsx', 'worker/routes/home.ts']);
      // @ts-expect-error The browser release runner is executable plain JavaScript.
      await import('./run-core-e2e.mjs');

      expect(execSync.mock.calls.map(([command]) => command)).toEqual(['npm run build']);
      expect(execFileSync.mock.calls.map(([command, args]) => [
        command, args.map((arg: string) => arg.replaceAll('\\', '/')),
      ])).toEqual([
        [process.execPath, [expect.stringMatching(/\/scripts\/prepare-core-test\.mjs$/u)]],
        [process.execPath, [expect.stringMatching(/\/@playwright\/test\/cli\.js$/u), 'test']],
        [process.execPath, [expect.stringMatching(/\/@playwright\/test\/cli\.js$/u), 'test',
          '--config', 'playwright.workspace-startup.config.ts',
          'tests/workspace-startup/backup-progress.spec.ts',
          'tests/workspace-startup/backup-restore.spec.ts',
          'tests/workspace-startup/input-focus.spec.ts']],
      ]);
      expect(execSync.mock.invocationCallOrder[0]).toBeLessThan(execFileSync.mock.invocationCallOrder[0]);
      expect(rmSync).toHaveBeenCalledOnce();
      expect(execFileSync.mock.invocationCallOrder.at(-1)).toBeLessThan(rmSync.mock.invocationCallOrder[0]);
    } finally {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    }
  });

  test('a release without page changes since the last deploy runs only the gate browser tests', async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('RELEASE_GATE_ONLY', '0');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      execSync.mockImplementation(() => '');
      execFileSync.mockImplementation(() => '');
      changedFilesSinceLastDeploy.mockReturnValue(['worker/scorepadApi.ts', 'migrations/0130_game_catalog_scorepad_fields.sql', 'docs/scorepad-integration.md']);
      // @ts-expect-error The browser release runner is executable plain JavaScript.
      await import('./run-core-e2e.mjs');
      const suites = execFileSync.mock.calls.map(([, args]) => args.slice(1));
      expect(suites[1]).toEqual(['test', '--grep-invert', '@ui']);
      expect(suites[2]).toEqual(expect.arrayContaining(['tests/workspace-startup/input-focus.spec.ts']));
    } finally {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    }
  });

  test('pins date-sensitive release checks to the product timezone', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
    const workflow = readFileSync('.github/workflows/core-release-gate.yml', 'utf8');

    expect(packageJson.scripts.test).toContain('cross-env TZ=Asia/Taipei vitest run');
    expect(packageJson.scripts['test:core']).toContain('cross-env TZ=Asia/Taipei vitest run');
    expect(workflow).toMatch(/env:\s*\r?\n\s+TZ:\s*Asia\/Taipei/);
  });

  test('uses the patched Node LTS version consistently for local development and CI', () => {
    const nodeVersion = readFileSync('.nvmrc', 'utf8').trim();
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      engines: { node: string };
      devEngines: { runtime: { name: string; version: string; onFail: string } };
    };
    const workflow = readFileSync('.github/workflows/core-release-gate.yml', 'utf8');

    expect(nodeVersion).toMatch(/^24\.\d+\.\d+$/);
    expect(packageJson.engines.node).toBe(`>=${nodeVersion} <25`);
    expect(packageJson.devEngines.runtime).toEqual({ name: 'node', version: packageJson.engines.node, onFail: 'error' });
    expect(workflow).toMatch(/node-version-file:\s*\.nvmrc/);
  });
});
