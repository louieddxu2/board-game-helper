import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const workspaceRoot = process.cwd();
const stateDirectory = path.resolve(workspaceRoot, '.wrangler', 'core-test-state');
const expectedParent = `${path.resolve(workspaceRoot, '.wrangler')}${path.sep}`;
if (!stateDirectory.startsWith(expectedParent) || path.basename(stateDirectory) !== 'core-test-state') {
  throw new Error(`拒絕清除非預期的核心測試目錄：${stateDirectory}`);
}

rmSync(stateDirectory, { recursive: true, force: true });
mkdirSync(stateDirectory, { recursive: true });

execFileSync(process.execPath, [
  path.resolve(workspaceRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
  'd1', 'migrations', 'apply',
  'board-game-helper-core-test', '--local', `--persist-to=${stateDirectory}`,
  '--config', 'wrangler.core-test.jsonc',
], {
  cwd: workspaceRoot,
  stdio: 'inherit',
  env: { ...process.env, XDG_CONFIG_HOME: path.resolve(workspaceRoot, '.wrangler', 'xdg') },
});
