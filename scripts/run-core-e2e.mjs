import { execFileSync, execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

const workspaceRoot = process.cwd();
const stateName = `core-test-state-${process.pid}`;
const port = 42000 + (process.pid % 10_000);
const env = { ...process.env, CORE_TEST_STATE_DIR: stateName, CORE_TEST_PORT: String(port) };
const run = (command, args) => execFileSync(command, args, { cwd: workspaceRoot, stdio: 'inherit', env });

try {
  execSync('npm run build', { cwd: workspaceRoot, stdio: 'inherit', env });
  run(process.execPath, [path.resolve('scripts', 'prepare-core-test.mjs')]);
  run(process.execPath, [path.resolve('node_modules', '@playwright', 'test', 'cli.js'), 'test']);
  run(process.execPath, [path.resolve('node_modules', '@playwright', 'test', 'cli.js'), 'test',
    '--config', 'playwright.workspace-startup.config.ts',
    'tests/workspace-startup/backup-progress.spec.ts', 'tests/workspace-startup/backup-restore.spec.ts']);
} finally {
  rmSync(path.resolve(workspaceRoot, '.wrangler', stateName), {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
