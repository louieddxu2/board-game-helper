import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const workspaceRoot = process.cwd();
const stateDirectory = path.resolve(workspaceRoot, '.wrangler', 'core-test-state');
const expectedParent = `${path.resolve(workspaceRoot, '.wrangler')}${path.sep}`;
const snapshotPath = path.resolve(workspaceRoot, 'tests', 'fixtures', 'production-d1-schema.sql');
const baselinePath = path.resolve(workspaceRoot, 'tests', 'fixtures', 'production-d1-schema.version');
const mode = process.env.CORE_TEST_DATABASE_MODE ?? 'snapshot';

if (!stateDirectory.startsWith(expectedParent) || path.basename(stateDirectory) !== 'core-test-state') {
  throw new Error(`拒絕清除非預期的核心測試目錄：${stateDirectory}`);
}

const wrangler = path.resolve(workspaceRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const executeArgs = ['d1', 'execute', 'board-game-helper-core-test', '--local', `--persist-to=${stateDirectory}`, '--config', 'wrangler.core-test.jsonc'];
const runWrangler = (args) => execFileSync(process.execPath, [wrangler, ...args], {
  cwd: workspaceRoot,
  stdio: 'inherit',
  env: { ...process.env, XDG_CONFIG_HOME: path.resolve(workspaceRoot, '.wrangler', 'xdg') },
});

rmSync(stateDirectory, { recursive: true, force: true });
mkdirSync(stateDirectory, { recursive: true });

if (mode === 'fresh') {
  runWrangler(['d1', 'migrations', 'apply', 'board-game-helper-core-test', '--local', `--persist-to=${stateDirectory}`, '--config', 'wrangler.core-test.jsonc']);
  process.exit(0);
}

if (mode !== 'snapshot') throw new Error(`未知的核心測試資料庫模式：${mode}`);
const baseline = readFileSync(baselinePath, 'utf8').trim();
const migrations = readdirSync(path.resolve(workspaceRoot, 'migrations')).filter((file) => file.endsWith('.sql')).sort();
const baselineIndex = migrations.indexOf(baseline);
if (baselineIndex === -1) throw new Error(`找不到 production schema baseline migration：${baseline}`);

runWrangler([...executeArgs, '--file', snapshotPath]);
for (const migration of migrations.slice(baselineIndex + 1)) {
  runWrangler([...executeArgs, '--file', path.resolve(workspaceRoot, 'migrations', migration)]);
}
