// Operator-only runner: use the same replay implementation as the Worker.
// Wrangler keeps credentials private; no API tokens are read or printed here.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database, DatabaseStatement } from '../worker/data/database';
import { processAttributeMergeRebuildJobs } from '../worker/data/attributes';

if (!process.argv.includes('--apply')) throw new Error('Pass --apply to run the pending win-history replay on production.');
const literal = (value: unknown) => value == null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const execute = (args: string[]) => JSON.parse(execFileSync(process.execPath, [
  'node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'board-game-rules-prod',
  '--remote', '--config', 'wrangler.production.jsonc', '--json', ...args,
], { encoding: 'utf8', env: { ...process.env, XDG_CONFIG_HOME: '.wrangler/xdg', CI: 'true' }, maxBuffer: 16 * 1024 * 1024 }));
class RemoteStatement {
  constructor(readonly sql: string) {}
  bind(...values: unknown[]) {
    let index = 0;
    const result = this.sql.replace(/\?/g, () => literal(values[index++]));
    if (index !== values.length) throw new Error('Binding count mismatch');
    return new RemoteStatement(result);
  }
  async all() { return execute(['--command', this.sql])[0]; }
  async run() { return this.all(); }
  async first() { return (await this.all()).results?.[0] ?? null; }
}
const db = {
  statement: (sql: string) => new RemoteStatement(sql),
  batch: async (statements: DatabaseStatement[]) => {
    const directory = mkdtempSync(join(tmpdir(), 'win-history-replay-'));
    const path = join(directory, 'batch.sql');
    try {
      writeFileSync(path, statements.map((statement) => (statement as unknown as RemoteStatement).sql + ';').join('\n'));
      execute(['--file', path, '--yes']);
      return [];
    } finally { unlinkSync(path); rmdirSync(directory); }
  },
} as Database;
const pending = await db.statement("SELECT id FROM attribute_merge_rebuild_jobs WHERE status IN ('pending','running')").all<{id:string}>();
if (pending.results?.some((row) => row.id !== 'win-history-replay-v1')) throw new Error('Another rebuild is active; refusing to run.');
await processAttributeMergeRebuildJobs(db, Date.now(), 100);
const job = await db.statement("SELECT status,error_message FROM attribute_merge_rebuild_jobs WHERE id='win-history-replay-v1'").first<{status:string;error_message:string|null}>();
console.log(JSON.stringify(job));
if (job?.status !== 'completed') throw new Error('Win-history replay did not complete.');
