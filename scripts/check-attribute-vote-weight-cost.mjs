// Operator-only, local D1 comparison. Requires an existing production-derived
// source export; never fetches or mutates a remote database.
import { Miniflare, convertV4MiniflareOptions } from '../node_modules/wrangler/node_modules/miniflare/dist/src/index.js';
import { build } from 'esbuild';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const [sourceArgument, baselineRef, exception] = process.argv.slice(2);
if (!sourceArgument || !/^[a-f0-9]{7,40}$/u.test(baselineRef ?? '')
  || (exception && exception !== '--allow-initial-transition')) {
  throw new Error('Usage: node scripts/check-attribute-vote-weight-cost.mjs <source.json> <baseline-commit> [--allow-initial-transition]');
}
const sourcePath = resolve(sourceArgument);
const audit = dirname(sourcePath);
const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
const persistence = join(audit, `local-${crypto.randomUUID()}`);
mkdirSync(persistence, { recursive: true });
const entry = join(audit, 'entry.ts');
writeFileSync(entry, `export { runCompleteAttributeReplay } from '${resolve('worker/workflows/attributeReplay.ts').replaceAll('\\', '/')}';\nexport { createDatabase } from '${resolve('worker/data/database.ts').replaceAll('\\', '/')}';\n`);
for (const variant of ['old', 'new']) {
  await build({ entryPoints: [entry], outfile: join(audit, `${variant}.mjs`), bundle: true, platform: 'node', format: 'esm',
    plugins: variant === 'new' ? [] : [{ name: 'committed-baseline', setup(b) {
      b.onLoad({ filter: /[\\/]worker[\\/].*\.ts$/ }, ({ path }) => ({
        contents: execFileSync('git', ['-c', 'core.fsmonitor=false', 'show', `${baselineRef}:${relative(root, path).replaceAll('\\', '/')}`], { encoding: 'utf8' }),
        loader: 'ts', resolveDir: dirname(path),
      }));
    } }],
  });
}
const options = () => ({ ...convertV4MiniflareOptions({ name: 'audit', modules: true,
  script: 'export default {fetch(){return new Response("ok")}}', compatibilityDate: '2026-07-22',
  d1Databases: { OLD: 'old', NEW: 'new' }, cf: false }),
  resourcePersistencePath: persistence, isolatedResourcePersistencePath: join(persistence, 'isolated'),
  unsafeDevRegistryPath: join(persistence, 'registry'), unsafeEnableSharedStorage: true });
let mf;
try {
mf = new Miniflare(options());
for (const name of ['OLD', 'NEW']) {
  const db = await mf.getD1Database(name, 'audit');
  await db.prepare('CREATE TABLE audit_identity (name TEXT)').run();
  await db.prepare('INSERT INTO audit_identity VALUES (?)').bind(name.toLowerCase()).run();
}
await mf.dispose();
const files = (folder) => readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? files(join(folder, entry.name)) : entry.name.endsWith('.sqlite') ? [join(folder, entry.name)] : []);
const localFiles = files(persistence).filter((file) => {
  const db = new DatabaseSync(file);
  try { return Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='audit_identity'").get()); }
  finally { db.close(); }
});
if (localFiles.length !== 2) throw new Error(`Expected two isolated local databases, found ${localFiles.length}`);
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
for (const file of localFiles) {
  const sqlite = new DatabaseSync(file);
  try {
    const name = sqlite.prepare('SELECT name FROM audit_identity').get().name;
    sqlite.exec('PRAGMA foreign_keys = OFF; DROP TABLE audit_identity; BEGIN;');
    for (const item of source.schema.filter((item) => item.type === 'table')) sqlite.exec(item.sql);
    const insert = (table, rows) => {
      if (!rows.length) return;
      const columns = Object.keys(rows[0]);
      const statement = sqlite.prepare(`INSERT INTO ${quote(table)} (${columns.map(quote).join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
      for (const row of rows) statement.run(...columns.map((key) => row[key] ?? null));
    };
    for (const [table, rows] of Object.entries(source.tables)) insert(table, rows);
    const stateRows = source.tables.attribute_replay_state_snapshot_chunks.flatMap((chunk) => JSON.parse(chunk.states_json));
    const states = stateRows.map(([subject_id, attribute_id, score, rating_deviation, direct_sum, direct_count,
      comparison_count, decisive_comparison_count, evidence_count, model_version], index) => ({
      subject_id, attribute_id, score, rating_deviation, direct_sum, direct_count, comparison_count,
      decisive_comparison_count, evidence_count, model_version, updated_at: 0,
      random_key: index.toString(16).padStart(32, '0'), question_slot: 1,
    }));
    // Normalized rows use the same authoritative checkpoint the production
    // replay compares against. Random keys/timestamps do not enter replay math.
    const stateKeys = new Set(states.map((row) => `${row.subject_id}\0${row.attribute_id}`));
    for (const subject of source.tables.attribute_subjects) for (const attr of source.tables.attributes.filter((a) => a.is_active)) {
      if (stateKeys.has(`${subject.id}\0${attr.id}`)) continue;
      states.push({ subject_id: subject.id, attribute_id: attr.id, score: 5, rating_deviation: 3, direct_sum: 0,
        direct_count: 0, comparison_count: 0, decisive_comparison_count: 0, evidence_count: 0,
        model_version: 'glicko-rd-v1', updated_at: 0, random_key: 'f'.repeat(32), question_slot: 1 });
    }
    insert('attribute_score_states', states);
    insert('attribute_pair_stats', source.tables.attribute_replay_snapshot_chunks.flatMap((chunk) => JSON.parse(chunk.pairs_json))
      .map(([subject_a_id, subject_b_id, attribute_id, comparison_count]) => ({ subject_a_id, subject_b_id, attribute_id, comparison_count, updated_at: 0 })));
    for (const item of source.schema.filter((item) => item.type === 'index')) sqlite.exec(item.sql);
    for (const item of source.schema.filter((item) => item.type === 'view')) sqlite.exec(item.sql);
    for (const item of source.schema.filter((item) => item.type === 'trigger')) sqlite.exec(item.sql);
    sqlite.exec('COMMIT;');
    console.log(JSON.stringify({ initialized: name, states: states.length, responses: source.tables.attribute_vote_responses.length }));
  } finally { sqlite.close(); }
}
mf = new Miniflare(options());
const report = { baselineRef, capturedAt: source.capturedAt,
  authorized: source.tables.user_roles.filter((r) => r.revoked_at == null).length,
  responses: source.tables.attribute_vote_responses.length, first: {}, settled: {} };
  for (const variant of ['old', 'new']) {
    const module = await import(pathToFileURL(join(audit, `${variant}.mjs`)).href);
    const raw = await mf.getD1Database(variant.toUpperCase(), 'audit');
    for (const [phase, offset] of [['first', 1], ['settled', 2]]) {
      const db = module.createDatabase({ DB: raw });
      const queries = [];
      const makeStatement = db.statement.bind(db), runBatch = db.batch.bind(db);
      const wrap = (statement, sql) => {
        statement.auditSql = sql;
        const bind = statement.bind.bind(statement);
        statement.bind = (...values) => wrap(bind(...values), sql);
        for (const method of ['all', 'run', 'first']) {
          const execute = statement[method].bind(statement);
          statement[method] = async () => {
            const before = db.metrics(); const result = await execute(); const after = db.metrics();
            queries.push({ sql, rowsRead: after.rowsRead - before.rowsRead, rowsWritten: after.rowsWritten - before.rowsWritten,
              changes: result?.meta?.changes ?? 0 });
            return result;
          };
        }
        return statement;
      };
      db.statement = (sql) => wrap(makeStatement(sql), sql);
      db.batch = async (statements) => {
        const results = await runBatch(statements);
        results.forEach((r, index) => queries.push({ sql: statements[index].auditSql,
          rowsRead: r.meta?.rows_read ?? 0, rowsWritten: r.meta?.rows_written ?? 0, changes: r.meta?.changes ?? 0 }));
        return results;
      };
      await module.runCompleteAttributeReplay(db, 1900000000000 + offset);
      report[phase][variant] = db.metrics();
      writeFileSync(join(audit, `${variant}-${phase}-queries.json`), JSON.stringify(queries, null, 2));
      report[phase][variant].statesUpdated = queries.filter((q) => /INSERT INTO attribute_score_states/.test(q.sql)).reduce((sum, q) => sum + q.changes, 0);
      console.log(JSON.stringify({ variant, phase, ...db.metrics() }));
    }
  }
  for (const phase of ['first', 'settled']) {
    const old = report[phase].old, next = report[phase].new;
    report[phase].delta = { rowsRead: next.rowsRead - old.rowsRead, rowsWritten: next.rowsWritten - old.rowsWritten };
    report[phase].delta.total = report[phase].delta.rowsRead + report[phase].delta.rowsWritten;
    report[phase].withinTen = report[phase].delta.total <= 10;
  }
  writeFileSync(join(audit, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.settled.withinTen || (!exception && !report.first.withinTen)) process.exitCode = 2;
} finally {
  await mf?.dispose();
  // This directory is created by this invocation, directly inside the named
  // audit folder. Never recursively remove an unchecked/computed parent path.
  if (dirname(resolve(persistence)) !== resolve(audit)) throw new Error('Unsafe cleanup target');
  rmSync(persistence, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
