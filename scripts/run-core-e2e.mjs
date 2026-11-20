import { execFileSync, execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { browserTestScope, changedFilesSinceLastDeploy } from './release-test-scope.mjs';

const workspaceRoot = process.cwd();
const stateName = `core-test-state-${process.pid}`;
const port = 42000 + (process.pid % 10_000);
const env = { ...process.env, CORE_TEST_STATE_DIR: stateName, CORE_TEST_PORT: String(port) };
const run = (command, args) => execFileSync(command, args, { cwd: workspaceRoot, stdio: 'inherit', env });
// CI runs only the gate (data, contracts, Workspace and attribute voting): it cannot stop a push,
// and Linux fonts shift the layout-sensitive @ui tests. A local release also runs only the gate
// when nothing page-related changed since the last successful deploy; otherwise it runs everything.
// --ui runs only the @ui tests, for work on the home, game and record pages; --all forces every test.
const uiOnly = process.argv.includes('--ui');
// Only the GitHub workflow sets RELEASE_GATE_ONLY; a generic CI flag set by some local tool must not skip tests.
const ciGateOnly = process.env.RELEASE_GATE_ONLY === '1';
const localScope = uiOnly || ciGateOnly || process.argv.includes('--all')
  ? null : browserTestScope(changedFilesSinceLastDeploy());
const gateOnly = ciGateOnly || localScope?.scope === 'gate';
const selection = uiOnly ? ['--grep', '@ui'] : gateOnly ? ['--grep-invert', '@ui'] : [];
console.log(uiOnly ? 'Browser tests: @ui only'
  : ciGateOnly ? 'Browser tests: release gate only (RELEASE_GATE_ONLY=1), @ui skipped'
    : gateOnly ? `Browser tests: release gate only, @ui skipped (${localScope.reason})`
      : `Browser tests: all, including @ui${localScope ? ` (${localScope.reason})` : ''}`);

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
