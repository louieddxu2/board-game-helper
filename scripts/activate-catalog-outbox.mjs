import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const wrangler = path.resolve(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const activationFile = path.resolve(root, 'scripts', 'catalog-outbox-activation.sql');
const common = ['d1', 'execute', 'board-game-rules-prod', '--remote', '--config', 'wrangler.production.jsonc'];

const run = (args) => execFileSync(process.execPath, [wrangler, ...args], {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, XDG_CONFIG_HOME: path.resolve(root, '.wrangler', 'xdg') },
});

const findMode = (value) => {
  if (Array.isArray(value)) {
    for (const item of value) {
      const mode = findMode(item);
      if (mode) return mode;
    }
  }
  if (value && typeof value === 'object') {
    if (typeof value.mode === 'string') return value.mode;
    for (const nested of Object.values(value)) {
      const mode = findMode(nested);
      if (mode) return mode;
    }
  }
  return undefined;
};

let mode;
try {
  mode = findMode(JSON.parse(run([...common, '--command', 'SELECT mode FROM catalog_outbox_settings WHERE id = 1', '--json'])));
} catch (error) {
  const details = error && typeof error === 'object'
    ? `${'stdout' in error ? String(error.stdout) : ''}\n${'stderr' in error ? String(error.stderr) : ''}`
    : String(error);
  if (/no such table: catalog_outbox_settings/i.test(details)) {
    console.log('Catalog outbox foundation is not installed; activation is not needed.');
    process.exit(0);
  }
  throw error;
}

if (mode === 'outbox') {
  console.log('Catalog outbox is already active.');
  process.exit(0);
}
if (mode !== 'legacy') throw new Error(`Unexpected catalog outbox mode: ${String(mode)}`);
if (!existsSync(activationFile)) throw new Error('Missing catalog outbox activation SQL.');

run([...common, '--file', activationFile]);
console.log('Catalog outbox triggers activated after compatible Worker deployment.');
