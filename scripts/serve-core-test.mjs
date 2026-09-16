import { spawnSync } from 'node:child_process';
import path from 'node:path';

const stateName = process.env.CORE_TEST_STATE_DIR ?? 'core-test-state';
const port = Number(process.env.CORE_TEST_PORT ?? 4173);
if (!/^core-test-state(?:-[a-z0-9-]+)?$/u.test(stateName)) throw new Error(`不安全的核心測試資料庫名稱：${stateName}`);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`不安全的核心測試連接埠：${port}`);

const result = spawnSync(process.execPath, [
  path.resolve('node_modules', 'wrangler', 'bin', 'wrangler.js'),
  'dev', '--config', 'wrangler.core-test.jsonc', '--port', String(port),
  `--persist-to=${path.join('.wrangler', stateName)}`,
], { stdio: 'inherit', env: { ...process.env, XDG_CONFIG_HOME: path.resolve('.wrangler', 'xdg') } });

process.exit(result.status ?? 1);
