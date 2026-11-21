// Local real D1, real receipt/scoring/catalog code. No remote access.
// Run: node --import tsx scripts/benchmark-attribute-ingestion.ts
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Miniflare, convertV4MiniflareOptions } from '../node_modules/wrangler/node_modules/miniflare/dist/src/index.js';
import { createDatabase } from '../worker/data/database';
import { saveAttributeResponse } from '../worker/data/attributeResponses';
import { flushCatalogOutbox } from '../worker/data/catalogOutbox';
import { hasPendingAttributeResponses, processAttributeResponses } from '../worker/workflows/attributeOnlineScoring';
import { ATTRIBUTE_SCORE_MODEL_VERSION, emptyAttributeState, type OnlineAttributeState } from '../worker/data/attributeScoring';
import { applyAttributeRanking } from '../worker/data/attributeRankingUpdate';
import { rankedAttributeSubjects } from '../worker/data/attributeRankedSubjects';
import type { StoredAttributeRankingBallot } from '../src/shared/attributeRankingBallot';
import type { D1Database, D1PreparedStatement } from '../worker/env';

const root = resolve('.wrangler'); mkdirSync(root, { recursive: true });
const scratch = mkdtempSync(join(root, 'attribute-ingestion-benchmark-'));
const names = ['SERIAL', 'CONCURRENT', 'HISTORY'] as const;
const runtime = () => new Miniflare({
  ...convertV4MiniflareOptions({ name: 'ingestion', modules: true, script: 'export default {}',
    compatibilityDate: '2026-07-22', cf: false,
    d1Databases: Object.fromEntries(names.map((name) => [name, name.toLowerCase()])),
  }),
  resourcePersistencePath: scratch, isolatedResourcePersistencePath: join(scratch, 'isolated'),
  unsafeDevRegistryPath: join(scratch, 'registry'), unsafeEnableSharedStorage: true,
});
let mf = runtime();
for (const name of names) await (await mf.getD1Database(name, 'ingestion'))
  .prepare(`CREATE TABLE benchmark_identity_${name} (id INTEGER)`).run();
await mf.dispose();
const files = new Map<string, string>();
for (const entry of readdirSync(join(scratch, 'd1/miniflare-D1DatabaseObject')).filter((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite')) {
  const file = join(scratch, 'd1/miniflare-D1DatabaseObject', entry);
  const sqlite = new DatabaseSync(file);
  for (const name of names) if (sqlite.prepare('SELECT 1 FROM sqlite_schema WHERE name = ?').get(`benchmark_identity_${name}`)) files.set(name, file);
  sqlite.close();
}
assert.equal(files.size, names.length);
const migrations = readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort();
const attributeId = 'attribute_setup_variability';
let ids: string[] = [];
for (const name of names) {
  const sqlite = new DatabaseSync(files.get(name)!);
  for (const migration of migrations) sqlite.exec(readFileSync(join('migrations', migration), 'utf8'));
  sqlite.exec(`DELETE FROM attribute_vote_responses; DELETE FROM attribute_score_states;
    DELETE FROM catalog_change_outbox;
    UPDATE attribute_online_progress SET through_rowid = 0, through_response_id = NULL;`);
  sqlite.prepare('UPDATE attribute_online_progress SET model_version = ? WHERE id = 1').run(ATTRIBUTE_SCORE_MODEL_VERSION);
  ids = sqlite.prepare(`SELECT subject.id FROM attribute_subjects subject
    JOIN attribute_votable_subjects votable ON votable.subject_id = subject.id
    WHERE subject.kind = 'game' ORDER BY subject.id LIMIT 6`).all().map((row) => String(row.id));
  assert.equal(ids.length, 6);
  if (name === 'HISTORY') {
    sqlite.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<100000)
      INSERT INTO attribute_vote_responses(response_id, attribute_id, subject_a_id, subject_b_id,
        comparison, activity_json, session_id, created_at, updated_at)
      SELECT 'old-' || i, ?, ?, ?, 'A_HIGHER', '[]', 'old-fixture', 1, 1 FROM n`).run(attributeId, ids[0], ids[1]);
    sqlite.exec(`UPDATE attribute_online_progress SET through_rowid = 100000, through_response_id = 'old-100000'`);
  }
  sqlite.close();
}
mf = runtime();
const report: Record<string, unknown>[] = [];
const traces: Array<{ scenario: string; request: number; sql: string; read: number; written: number }> = [];
try {
  for (const name of names) {
    const raw = await mf.getD1Database(name, 'ingestion') as unknown as D1Database;
    const requests: ReturnType<typeof createDatabase>[] = [];
    const readers = new Set<number>();
    const apiCallCounts: number[] = [];
    const outputs: Awaited<ReturnType<typeof saveAttributeResponse>>[] = [];
    const run = async (index: number) => {
      let apiCalls = 0;
      const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
      const sqls = new WeakMap<D1PreparedStatement, string>();
      const record = (sql: string, meta: { rows_read?: number; rows_written?: number } = {}) => {
        traces.push({ scenario: name, request: index, sql, read: meta.rows_read ?? 0, written: meta.rows_written ?? 0 });
      };
      const wrap = (p: D1PreparedStatement, sql: string): D1PreparedStatement => {
        const prepared: D1PreparedStatement = {
          bind: (...values) => wrap(p.bind(...values), sql),
          first: async <T>() => { apiCalls++; const r = await p.all<T>(); record(sql, r.meta); return r.results?.[0] ?? null; },
          all: async <T>() => { apiCalls++; const r = await p.all<T>(); record(sql, r.meta); return r; },
          run: async <T>() => { apiCalls++; const r = await p.run<T>(); record(sql, r.meta); return r; },
        };
        originals.set(prepared, p); sqls.set(prepared, sql); return prepared;
      };
      const traced: D1Database = {
        prepare: (sql) => wrap(raw.prepare(sql), sql),
        batch: async (statements) => {
          apiCalls++;
          const result = await raw.batch(statements.map((p) => originals.get(p)!));
          result.forEach((r, i) => record(sqls.get(statements[i])!, r.meta)); return result;
        },
      };
      const db = createDatabase({ DB: traced }); requests.push(db);
      const statement = db.statement.bind(db);
      db.statement = (sql) => {
        if (sql.includes('LEFT JOIN attribute_score_states state')) readers.add(index);
        return statement(sql);
      };
      const result = await saveAttributeResponse(db, {
        attributeId, subjectAId: ids[0], subjectBId: ids[1], responseId: 'benchmark-' + index,
        actorId: null, sessionId: 'person-' + index, timestamp: Date.now(),
        ranking: { version: 1, orderedSubjectIds: ids, referenceSubjectIds: [] },
      });
      outputs.push(result);
      await flushCatalogOutbox(db);
      apiCallCounts.push(apiCalls);
    };
    const start = performance.now();
    if (name === 'SERIAL') for (let i = 0; i < 10; i++) await run(i);
    else await Promise.all(Array.from({ length: 10 }, (_, i) => run(i)));
    const control = createDatabase({ DB: raw });
    assert.equal(await hasPendingAttributeResponses(control), false, 'The ten upload-triggered requests must drain without an extra trigger');
    const states = (await raw.prepare('SELECT subject_id, score, rating_deviation, comparison_count, evidence_count FROM attribute_score_states WHERE attribute_id = ?')
      .bind(attributeId).all()).results as Array<{ subject_id: string; score: number; rating_deviation: number; comparison_count: number; evidence_count: number }>;
    const ballots = (await raw.prepare(`SELECT ranking_json, online_weight
      FROM attribute_vote_responses WHERE session_id LIKE 'person-%' ORDER BY rowid`)
      .all<{ ranking_json: string; online_weight: number }>()).results ?? [];
    assert.equal(ballots.length, 10);
    const expected = new Map<string, OnlineAttributeState>(ids.map((id) => [id, emptyAttributeState()]));
    for (const row of ballots) {
      const order = rankedAttributeSubjects(JSON.parse(row.ranking_json) as StoredAttributeRankingBallot);
      const next = applyAttributeRanking(order.map((id) => expected.get(id)!), row.online_weight);
      order.forEach((id, index) => expected.set(id, next[index]));
    }
    for (const row of states) {
      const e = expected.get(row.subject_id)!;
      assert.equal(row.score, e.score); assert.equal(row.rating_deviation, e.ratingDeviation);
      assert.equal(row.comparison_count, e.comparisonCount); assert.equal(row.evidence_count, e.evidenceCount);
    }
    const totals = requests.reduce((sum, db) => {
      const m = db.metrics(); return { rowsRead: sum.rowsRead + m.rowsRead, rowsWritten: sum.rowsWritten + m.rowsWritten, queries: sum.queries + m.queries };
    }, { rowsRead: 0, rowsWritten: 0, queries: 0 });
    const item = { name, includes: 'receipt validation, scoring, real schema indexes/triggers and catalog publication',
      uploads: 10, historicalRows: name === 'HISTORY' ? 100000 : 0, ...totals,
      scoreReaders: readers.size, pendingResponses: outputs.filter((r) => r.scoreStatus === 'pending').length,
      maxQueriesPerRequest: Math.max(...requests.map((db) => db.metrics().queries)),
      maxApiCallsPerRequest: Math.max(...apiCallCounts),
      ms: Math.round(performance.now() - start), allVotesSavedAndScoredExactlyOnce: true };
    assert(item.maxApiCallsPerRequest <= 50, 'Free D1 invocation API call limit exceeded');
    report.push(item); console.log(JSON.stringify(item));
    // Durable SQL failure, followed by server-only recovery on the actual D1 runtime.
    if (name === 'CONCURRENT') {
      await raw.prepare(`CREATE TRIGGER inject_failure BEFORE UPDATE ON attribute_online_progress BEGIN SELECT RAISE(ABORT, 'injected failure'); END`).run();
      const db = createDatabase({ DB: raw });
      const before = JSON.stringify((await raw.prepare('SELECT * FROM attribute_score_states ORDER BY subject_id, attribute_id').all()).results);
      const receipt = await saveAttributeResponse(db, { attributeId, subjectAId: ids[0], subjectBId: ids[1],
        responseId: 'recover', actorId: null, sessionId: 'recovery', timestamp: Date.now(), comparison: 'A_HIGHER' });
      assert.equal(receipt.scoreStatus, 'pending');
      assert.equal(JSON.stringify((await raw.prepare('SELECT * FROM attribute_score_states ORDER BY subject_id, attribute_id').all()).results), before);
      await raw.prepare('DROP TRIGGER inject_failure').run();
      assert.equal((await processAttributeResponses(db)).status, 'processed');
      assert.equal(await hasPendingAttributeResponses(db), false);
      console.log(JSON.stringify({ realD1AtomicRollbackAndServerRecovery: true }));
    }
  }
  writeFileSync(join(root, 'attribute-ingestion-benchmark-results.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(root, 'attribute-ingestion-query-costs.json'), JSON.stringify(traces, null, 2));
} finally { await mf.dispose(); }
