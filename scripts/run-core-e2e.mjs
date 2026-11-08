import { execFileSync, execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

const workspaceRoot = process.cwd();
const stateName = `core-test-state-${process.pid}`;
const port = 42000 + (process.pid % 10_000);
const env = { ...process.env, CORE_TEST_STATE_DIR: stateName, CORE_TEST_PORT: String(port) };
const run = (command, args) => execFileSync(command, args, { cwd: workspaceRoot, stdio: 'inherit', env });
// A local release runs every browser test. CI runs only the gate (data, contracts, Workspace and
// attribute voting): it cannot stop a push, and Linux fonts shift the layout-sensitive @ui tests.
// --ui runs only the @ui tests, for work on the home, game and record pages.
const uiOnly = process.argv.includes('--ui');
const gateOnly = Boolean(process.env.CI);
const selection = uiOnly ? ['--grep', '@ui'] : gateOnly ? ['--grep-invert', '@ui'] : [];

try {
  execSync('npm run build', { cwd: workspaceRoot, stdio: 'inherit', env });
  run(process.execPath, [path.resolve('scripts', 'prepare-core-test.mjs')]);
  run(process.execPath, [path.resolve('node_modules', '@playwright', 'test', 'cli.js'), 'test', ...selection]);
  if (!uiOnly) run(process.execPath, [path.resolve('node_modules', '@playwright', 'test', 'cli.js'), 'test',
    '--config', 'playwright.workspace-startup.config.ts',
    'tests/workspace-startup/backup-progress.spec.ts', 'tests/workspace-startup/backup-restore.spec.ts',
    'tests/workspace-startup/input-focus.spec.ts']);
} finally {
  rmSync(path.resolve(workspaceRoot, '.wrangler', stateName), {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
