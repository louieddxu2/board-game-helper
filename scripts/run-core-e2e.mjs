import { execFileSync, execSync } from 'node:child_process';
import path from 'node:path';

const workspaceRoot = process.cwd();
const stateName = `core-test-state-${process.pid}`;
const port = 42000 + (process.pid % 10_000);
const env = { ...process.env, CORE_TEST_STATE_DIR: stateName, CORE_TEST_PORT: String(port) };
const run = (command, args) => execFileSync(command, args, { cwd: workspaceRoot, stdio: 'inherit', env });

execSync('npm run build', { cwd: workspaceRoot, stdio: 'inherit', env });
run(process.execPath, [path.resolve('scripts', 'prepare-core-test.mjs')]);
run(process.execPath, [path.resolve('node_modules', '@playwright', 'test', 'cli.js'), 'test']);
