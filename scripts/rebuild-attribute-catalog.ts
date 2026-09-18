// Operator-only runner: replay production attribute votes, then publish the
// resulting catalog snapshot. It deliberately has no snapshot-only path.
// Wrangler keeps credentials private; no API tokens are read or printed here.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database, DatabaseStatement } from '../worker/data/database';
import { runCompleteAttributeReplay } from '../worker/workflows/attributeReplay';

const literal = (value: unknown) => value == null
  ? 'NULL'
  : typeof value === 'number'
    ? String(value)
    : `'${String(value).replaceAll("'", "''")}'`;

const execute = (args: string[]) => {
  const output = execFileSync(process.execPath, [
    'node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'board-game-rules-prod',
    '--remote', '--config', 'wrangler.production.jsonc', '--json', ...args,
  ], {
    encoding: 'utf8',
    env: { ...process.env, XDG_CONFIG_HOME: '.wrangler/xdg', CI: 'true' },
    maxBuffer: 32 * 1024 * 1024,
  });
  return args.includes('--file') ? [] : JSON.parse(output);
};

class RemoteStatement implements DatabaseStatement {
  constructor(readonly sql: string) {}

  bind(...values: unknown[]): DatabaseStatement {
    let index = 0;
    const sql = this.sql.replace(/\?/g, () => literal(values[index++]));
    if (index !== values.length) throw new Error('Binding count mismatch');
    return new RemoteStatement(sql);
  }

  async all<T = Record<string, unknown>>() {
    return execute(['--command', this.sql])[0] as { results?: T[]; success?: boolean };
  }

  async run<T = Record<string, unknown>>() {
    return this.all<T>();
  }

  async first<T = Record<string, unknown>>() {
    return (await this.all<T>()).results?.[0] ?? null;
  }
}

const db: Database = {
  statement: (sql: string) => new RemoteStatement(sql),
  batch: async (statements: DatabaseStatement[]) => {
    const directory = mkdtempSync(join(tmpdir(), 'attribute-catalog-rebuild-'));
    try {
      // Wrangler's remote --file path sends the whole file as one SQLite
      // statement. Execute each prepared statement separately so the large
      // snapshot chunks stay below SQLITE_TOOBIG.
      for (const [index, statement] of statements.entries()) {
        const path = join(directory, `statement-${index}.sql`);
        try {
          writeFileSync(path, `${(statement as RemoteStatement).sql};`);
          execute(['--file', path, '--yes']);
        } finally {
          unlinkSync(path);
        }
      }
      return [];
    } finally {
      rmdirSync(directory);
    }
  },
};

const timestamp = Date.now();
// Keep operator SQL statements comfortably below the Wrangler/D1 CLI limit.
await runCompleteAttributeReplay(db, timestamp, { maxChunkBytes: 50_000 });
const state = await db.statement(`
  SELECT active_generation, through_version, chunk_count, generated_at
  FROM attribute_catalog_snapshot_state WHERE id=1
`).first<{ active_generation: number; through_version: number; chunk_count: number; generated_at: number }>();
const win = await db.statement(`
  SELECT COUNT(*) AS value_count,
    MIN(rating_deviation) AS min_rd,
    MAX(rating_deviation) AS max_rd,
    SUM(CASE WHEN evidence_count > 0 THEN 1 ELSE 0 END) AS evidence_values
  FROM attribute_score_states WHERE attribute_id='attribute_win_method'
`).first<{ value_count: number; min_rd: number; max_rd: number; evidence_values: number }>();

console.log(JSON.stringify({
  replayed: true,
  snapshot: state,
  winMethod: win,
}));

if (!state || state.active_generation !== timestamp) {
  throw new Error('attribute_catalog_snapshot_verification_failed');
}
if (!win || Number(win.value_count) === 0) throw new Error('attribute_win_method_missing_after_rebuild');
