// Compare the deployed Git revision and working tree using isolated real D1.
// node scripts/compare-attribute-ingestion.mjs <baseline-sha> [scenario ...]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { DatabaseSync } from 'node:sqlite';
import { Miniflare, convertV4MiniflareOptions } from '../node_modules/wrangler/node_modules/miniflare/dist/src/index.js';

const [baseline, ...selected] = process.argv.slice(2);
assert(/^[a-f0-9]{7,40}$/.test(baseline ?? ''), 'Provide the deployed commit SHA');
const cases = [
  { id: 'pair-serial', kind: 'pair', serial: true },
  { id: 'configuration-pair-serial', kind: 'pair', serial: true, configuration: true },
  { id: 'configuration-ranking-serial', serial: true, configuration: true },
  { id: 'pair-spaced', kind: 'pair', spaced: true },
  { id: 'ranking-spaced', spaced: true },
  { id: 'ranking-concurrent' },
  { id: 'disjoint-concurrent', disjoint: true },
  { id: 'history-concurrent', history: 100000 },
];
assert(selected.every((id) => cases.some((c) => c.id === id)), 'Unknown scenario');
const scenarios = cases.filter((c) => !selected.length || selected.includes(c.id));
const root = process.cwd();
mkdirSync('.wrangler', { recursive: true });
const scratch = mkdtempSync(resolve('.wrangler/attribute-baseline-comparison-'));
const entry = join(scratch, 'entry.ts');
const absolute = (path) => resolve(path).replaceAll('\\', '/');
const entryExports = [
  `export { saveAttributeResponse } from '${absolute('worker/data/attributeResponses.ts')}';`,
  `export { createDatabase } from '${absolute('worker/data/database.ts')}';`,
  `export { flushCatalogOutbox } from '${absolute('worker/data/catalogOutbox.ts')}';`,
  `export { ATTRIBUTE_SCORE_MODEL_VERSION, applyComparison, emptyAttributeState } from '${absolute('worker/data/attributeScoring.ts')}';`,
  `export { expandStoredRankingResponse } from '${absolute('src/shared/attributeRankingBallot.ts')}';`,
];
const modules = {};
const baselineFiles = new Set(execFileSync('git', ['ls-tree', '-r', '--name-only', baseline, '--', 'worker', 'src/shared'], { encoding: 'utf8' }).trim().split('\n'));
for (const variant of ['old', 'new']) {
  const hasJointRanking = variant === 'new' || baselineFiles.has('worker/data/attributeRankingUpdate.ts');
  writeFileSync(entry, [...entryExports, ...(hasJointRanking ? [
    `export { applyAttributeRanking } from '${absolute('worker/data/attributeRankingUpdate.ts')}';`,
    `export { rankedAttributeSubjects } from '${absolute('worker/data/attributeRankedSubjects.ts')}';`,
  ] : [])].join('\n'));
  const outfile = join(scratch, variant + '.mjs');
  await build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'esm',
    plugins: variant === 'new' ? [] : [{ name: 'deployed-source', setup(b) {
      // A source file deleted by the candidate still has to resolve in the
      // deployed revision. Resolve historical files before filesystem lookup.
      b.onResolve({ filter: /^\./ }, (args) => {
        const path = resolve(args.resolveDir, args.path);
        const candidate = /\.tsx?$/.test(path) ? path : path + '.ts';
        if (baselineFiles.has(relative(root, candidate).replaceAll('\\', '/'))) return { path: candidate };
      });
      b.onLoad({ filter: /[\\/](?:worker|src[\\/]shared)[\\/].*\.ts$/ }, ({ path }) => ({
        contents: execFileSync('git', ['-c', 'core.fsmonitor=false', 'show', `${baseline}:${relative(root, path).replaceAll('\\', '/')}`], { encoding: 'utf8' }),
        loader: 'ts', resolveDir: dirname(path),
      }));
    } }],
  });
  modules[variant] = await import(pathToFileURL(outfile).href);
}
const names = scenarios.flatMap((c) => ['old', 'new'].map((v) => `${v}_${c.id.replaceAll('-', '_')}`));
const options = () => ({ ...convertV4MiniflareOptions({ name: 'compare', modules: true,
  script: 'export default {}', compatibilityDate: '2026-07-22', cf: false,
  d1Databases: Object.fromEntries(names.map((name) => [name, name])),
}), resourcePersistencePath: scratch, isolatedResourcePersistencePath: join(scratch, 'isolated'),
unsafeDevRegistryPath: join(scratch, 'registry'), unsafeEnableSharedStorage: true });
let mf = new Miniflare(options());
for (const name of names) await (await mf.getD1Database(name, 'compare')).prepare(`CREATE TABLE comparison_${name}(id INTEGER)`).run();
await mf.dispose();
const idsByName = new Map();
const migrations = readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort();
const oldMigrations = execFileSync('git', ['ls-tree', '-r', '--name-only', baseline, '--', 'migrations'], { encoding: 'utf8' }).trim().split('\n').filter((p) => p.endsWith('.sql')).sort();
const oldSql = oldMigrations.map((path) => execFileSync('git', ['show', `${baseline}:${path}`], { encoding: 'utf8' }));
const attributeId = 'attribute_setup_variability';
for (const file of readdirSync(join(scratch, 'd1/miniflare-D1DatabaseObject')).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite')) {
  const sqlite = new DatabaseSync(join(scratch, 'd1/miniflare-D1DatabaseObject', file));
  try {
    const name = names.find((n) => sqlite.prepare('SELECT 1 FROM sqlite_schema WHERE name = ?').get('comparison_' + n));
    if (!name) continue;
    const isNew = name.startsWith('new_');
    if (isNew) for (const migration of migrations) sqlite.exec(readFileSync(join('migrations', migration), 'utf8'));
    else for (const sql of oldSql) sqlite.exec(sql);
    sqlite.exec('DELETE FROM attribute_vote_responses; DELETE FROM attribute_score_states; DELETE FROM catalog_change_outbox');
    const variant = isNew ? 'new' : 'old';
    if (sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'attribute_online_progress'").get()) {
      sqlite.prepare('UPDATE attribute_online_progress SET through_rowid = 0, through_response_id = NULL, model_version = ?')
        .run(modules[variant].ATTRIBUTE_SCORE_MODEL_VERSION);
    }
    const configuration = name.includes('configuration');
    const ids = sqlite.prepare(`SELECT subject.id FROM attribute_subjects subject
      JOIN attribute_votable_subjects votable ON votable.subject_id = subject.id
      WHERE subject.kind = ? ORDER BY subject.id LIMIT ?`).all(configuration ? 'configuration' : 'game', configuration ? 6 : 60).map((row) => row.id);
    assert.equal(ids.length, configuration ? 6 : 60); idsByName.set(name, ids);
    if (name.includes('history')) {
      sqlite.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<100000)
        INSERT INTO attribute_vote_responses(response_id, attribute_id, subject_a_id, subject_b_id,
          comparison, activity_json, session_id, created_at, updated_at)
        SELECT 'old-' || i, ?, ?, ?, 'A_HIGHER', '[]', 'old-fixture', 1, 1 FROM n`).run(attributeId, ids[0], ids[1]);
      if (sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'attribute_online_progress'").get()) {
        sqlite.exec("UPDATE attribute_online_progress SET through_rowid = 100000, through_response_id = 'old-100000'");
      }
    }
  } finally { sqlite.close(); }
}
mf = new Miniflare(options());
const report = { baseline, candidate: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  scope: 'Local D1; deployed schema/source vs working schema/source; receipt/scoring/indexes/triggers/catalog publication; excludes common session middleware', scenarios: [] };
const baselineStates = new Map();
try {
  for (const scenario of scenarios) for (const variant of ['old', 'new']) {
    const name = `${variant}_${scenario.id.replaceAll('-', '_')}`;
    const m = modules[variant], raw = await mf.getD1Database(name, 'compare'), ids = idsByName.get(name);
    const requests = [], calls = [], first = [];
    let retryCount = 0;
    const post = async (i) => {
      const db = m.createDatabase({ DB: raw }); requests.push(db);
      let callCount = 0; calls.push(() => callCount);
      const statement = db.statement.bind(db);
      const wrap = (p) => {
        const bind = p.bind.bind(p);
        p.bind = (...values) => wrap(bind(...values));
        for (const method of ['first', 'all', 'run']) {
          const run = p[method].bind(p);
          p[method] = async () => { callCount++; return run(); };
        }
        return p;
      };
      db.statement = (sql) => wrap(statement(sql));
      const batch = db.batch.bind(db);
      db.batch = async (ps) => { callCount++; return batch(ps); };
      const players = scenario.disjoint ? ids.slice(i * 6, i * 6 + 6) : ids.slice(0, scenario.kind === 'pair' ? 2 : 6);
      const input = { attributeId, subjectAId: players[0], subjectBId: players[1], responseId: 'comparison-' + i,
        actorId: null, sessionId: 'person-' + i, timestamp: Date.now(),
        ...(scenario.kind === 'pair' ? { comparison: 'A_HIGHER' } : { ranking: { version: 1, orderedSubjectIds: players, referenceSubjectIds: [] } }) };
      try {
        await m.saveAttributeResponse(db, input); await m.flushCatalogOutbox(db); return true;
      } catch (error) { if (error.message === 'attribute_response_busy') return false; throw error; }
    };
    const start = performance.now();
    if (scenario.spaced || scenario.serial) {
      for (let i = 0; i < 10; i++) {
        if (scenario.spaced) await new Promise((done) => setTimeout(done, Math.max(0, start + i * 2000 - performance.now())));
        first[i] = await post(i);
      }
    } else first.push(...await Promise.all(Array.from({ length: 10 }, (_, i) => post(i))));
    for (let i = 0; i < 10; i++) if (!first[i]) { retryCount++; assert.equal(await post(i), true); }
    // Verify final derived counts/precision against every persisted original vote
    // in actual commit order. Verification queries are excluded from workload cost.
    const ballots = (await raw.prepare(`SELECT response_id, subject_a_id, subject_b_id, rating_a, rating_b, comparison, ranking_json
      FROM attribute_vote_responses WHERE session_id LIKE 'person-%' ORDER BY rowid`).all()).results;
    assert.equal(ballots.length, 10);
    const expected = new Map();
    for (const ballot of ballots) {
      if (m.applyAttributeRanking && ballot.ranking_json) {
        const order = m.rankedAttributeSubjects(JSON.parse(ballot.ranking_json));
        const scores = m.applyAttributeRanking(order.map((id) => expected.get(id) ?? m.emptyAttributeState()), 1);
        order.forEach((id, index) => expected.set(id, scores[index]));
        continue;
      }
      for (const row of m.expandStoredRankingResponse(ballot)) {
        const next = m.applyComparison(expected.get(row.subject_a_id) ?? m.emptyAttributeState(), expected.get(row.subject_b_id) ?? m.emptyAttributeState(), row.comparison);
        expected.set(row.subject_a_id, next.a.next); expected.set(row.subject_b_id, next.b.next);
      }
    }
    const states = (await raw.prepare('SELECT * FROM attribute_score_states WHERE attribute_id = ?').bind(attributeId).all()).results;
    assert.equal(states.length, expected.size);
    for (const s of states) {
      const e = expected.get(s.subject_id); assert.equal(s.score, e.score); assert.equal(s.rating_deviation, e.ratingDeviation);
      assert.equal(s.comparison_count, e.comparisonCount); assert.equal(s.evidence_count, e.evidenceCount);
    }
    const canonicalStates = states.map((s) => [s.subject_id, s.attribute_id, s.score, s.rating_deviation,
      s.direct_sum, s.direct_count, s.comparison_count, s.decisive_comparison_count, s.evidence_count])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    if (variant === 'old') baselineStates.set(scenario.id, canonicalStates);
    else {
      const shape = scenario.kind !== 'pair' && modules.old.ATTRIBUTE_SCORE_MODEL_VERSION !== m.ATTRIBUTE_SCORE_MODEL_VERSION
        ? (rows) => rows.map((row) => [...row.slice(0, 2), ...row.slice(4)]) : (rows) => rows;
      assert.deepEqual(shape(canonicalStates), shape(baselineStates.get(scenario.id)), 'Old and new score/count results differ');
    }
    const totals = requests.reduce((sum, db) => { const s = db.metrics(); return { reads: sum.reads + s.rowsRead, writes: sum.writes + s.rowsWritten, sql: sum.sql + s.queries }; }, { reads: 0, writes: 0, sql: 0 });
    const item = { scenario: scenario.id, variant, firstAccepted: first.filter(Boolean).length, retries: retryCount,
      savedAndScored: ballots.length, ...totals, maxSql: Math.max(...requests.map((db) => db.metrics().queries)), ms: Math.round(performance.now() - start) };
    item.apiCalls = calls.reduce((total, count) => total + count(), 0);
    item.maxApiCalls = Math.max(...calls.map((count) => count()));
    assert(item.maxApiCalls <= 50, 'Free D1 API invocation limit exceeded');
    report.scenarios.push(item); console.log(JSON.stringify(item));
    writeFileSync(resolve('.wrangler/attribute-baseline-comparison.json'), JSON.stringify(report, null, 2));
  }
  writeFileSync(resolve('.wrangler/attribute-baseline-comparison.json'), JSON.stringify(report, null, 2));
  for (const scenario of scenarios) {
    const old = report.scenarios.find((r) => r.scenario === scenario.id && r.variant === 'old');
    const next = report.scenarios.find((r) => r.scenario === scenario.id && r.variant === 'new');
    // At most 10% more reads in the ordinary pair path, in exchange for durable
    // receipts. Rankings and concurrent publication must stay below the baseline.
    assert(next.reads <= old.reads * (scenario.kind === 'pair' ? 1.1 : 1));
    assert(next.writes <= old.writes);
    assert.equal(next.firstAccepted, 10);
  }
} finally { await mf.dispose(); }
