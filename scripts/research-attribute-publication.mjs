// Isolated, real D1 comparison: historical baseline vs the actual working tree.
// node scripts/research-attribute-publication.mjs [scenario ...]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from '../node_modules/wrangler/node_modules/miniflare/dist/src/index.js';

const cases = [
  { id: 'pair-serial', pair: true },
  { id: 'pair-direct-serial', pair: true, direct: true },
  { id: 'ranking-serial' },
  { id: 'ranking-concurrent', concurrent: true },
  { id: 'disjoint-concurrent', concurrent: true, disjoint: true },
  { id: 'history-concurrent', concurrent: true, history: true },
];
const selected = process.argv.slice(2);
assert(selected.every((id) => cases.some((c) => c.id === id)), 'Unknown scenario');
const scenarios = cases.filter((c) => !selected.length || selected.includes(c.id));
mkdirSync('.wrangler', { recursive: true });
const scratch = mkdtempSync(resolve('.wrangler/attribute-publication-research-'));
const absolute = (path) => resolve(path).replaceAll('\\', '/');
const entry = join(scratch, 'entry.ts');
writeFileSync(entry, [
  `export { createDatabase } from '${absolute('worker/data/database.ts')}';`,
  `export { saveAttributeResponse } from '${absolute('worker/data/attributeResponses.ts')}';`,
  `export { processAttributeResponses, hasPendingAttributeResponses } from '${absolute('worker/workflows/attributeOnlineScoring.ts')}';`,
  `export { flushCatalogOutbox } from '${absolute('worker/data/catalogOutbox.ts')}';`,
  `export { queryAttributeSubjects, queryAttributeSubjectBundles } from '${absolute('worker/data/attributeQueries.ts')}';`,
  `export { queryAttributeCatalogChanges, attributeCatalogChangesPayload } from '${absolute('worker/data/attributeCatalog.ts')}';`,
  `export { applyAttributeCatalogChanges } from '${absolute('src/lib/attributeCatalog.ts')}';`,
  `export { stateToMatrixValue } from '${absolute('worker/data/attributeResponseContext.ts')}';`,
  `export { runCompleteAttributeReplay } from '${absolute('worker/workflows/attributeReplay.ts')}';`,
  `export { queryAttributeCatalogSnapshot, attributeCatalogPayload } from '${absolute('worker/data/attributeCatalog.ts')}';`,
].join('\n'));
const modules = {};
for (const variant of ['current', 'inline']) {
  const outfile = join(scratch, variant + '.mjs');
  await build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'esm',
    plugins: variant !== 'current' ? [] : [{ name: 'committed-baseline', setup(b) {
      b.onLoad({ filter: /[\\/](?:worker|src[\\/]shared)[\\/].*\.ts$/ }, ({ path }) => ({
        contents: execFileSync('git', ['-c', 'core.fsmonitor=false', 'show',
          `45662e9:${relative(process.cwd(), path).replaceAll('\\', '/')}`], { encoding: 'utf8' }),
        loader: 'ts', resolveDir: dirname(path),
      }));
    } }],
  });
  modules[variant] = await import(pathToFileURL(outfile).href);
}
modules.lean = modules.current;
modules.inline_lean = modules.inline;
const variants = ['current', 'lean', 'inline', 'inline_lean'];
const obsoleteIndexes = ['idx_attribute_score_states_question_slot',
  'idx_attribute_score_states_question_slot_global', 'idx_attribute_score_states_attribute_score'];
const names = scenarios.flatMap((s) => variants.map((v) => `${v}_${s.id.replaceAll('-', '_')}`));
const options = () => ({ ...convertV4MiniflareOptions({ name: 'publication', modules: true,
  script: 'export default {}', compatibilityDate: '2026-07-22', cf: false,
  d1Databases: Object.fromEntries(names.map((name) => [name, name])),
}), resourcePersistencePath: scratch, isolatedResourcePersistencePath: join(scratch, 'isolated'),
unsafeDevRegistryPath: join(scratch, 'registry'), unsafeEnableSharedStorage: true });
let mf = new Miniflare(options());
for (const name of names) await (await mf.getD1Database(name, 'publication')).prepare(`CREATE TABLE research_${name}(id INTEGER)`).run();
await mf.dispose();
const idsByName = new Map();
const migrations = readdirSync('migrations').filter((n) => n.endsWith('.sql')).sort();
const attributeId = 'attribute_setup_variability';
for (const filename of readdirSync(join(scratch, 'd1/miniflare-D1DatabaseObject')).filter((n) => n.endsWith('.sqlite') && n !== 'metadata.sqlite')) {
  const sqlite = new DatabaseSync(join(scratch, 'd1/miniflare-D1DatabaseObject', filename));
  try {
    const name = names.find((n) => sqlite.prepare('SELECT 1 FROM sqlite_schema WHERE name = ?').get('research_' + n));
    if (!name) continue;
    for (const migration of migrations) {
      if (migration.startsWith('0128_') && !name.startsWith('lean_') && !name.startsWith('inline_lean_')) continue;
      if (migration.startsWith('0129_') && !name.startsWith('inline_')) continue;
      sqlite.exec(readFileSync(join('migrations', migration), 'utf8'));
    }
    if (name.startsWith('lean_') || name.startsWith('inline_lean_')) {
      for (const index of obsoleteIndexes) assert(!sqlite.prepare('SELECT 1 FROM sqlite_schema WHERE name = ?').get(index));
      // Keep the subject PK and an attribute-prefixed index for both foreign keys.
      const indexes = sqlite.prepare('PRAGMA index_list(attribute_score_states)').all();
      const prefixes = indexes.map((index) => sqlite.prepare(`PRAGMA index_info(${index.name})`).all().map((c) => c.name));
      assert(prefixes.some((columns) => columns[0] === 'subject_id'));
      assert(prefixes.some((columns) => columns[0] === 'attribute_id'));
    }
    sqlite.exec(`DELETE FROM attribute_vote_responses; DELETE FROM attribute_score_states; DELETE FROM catalog_change_outbox;
      UPDATE attribute_online_progress SET through_rowid = 0, through_response_id = NULL`);
    const ids = sqlite.prepare(`SELECT subject.id FROM attribute_subjects subject
      JOIN attribute_votable_subjects votable ON votable.subject_id = subject.id
      WHERE subject.kind = 'game' ORDER BY subject.id LIMIT 60`).all().map((r) => r.id);
    assert.equal(ids.length, 60); idsByName.set(name, ids);
    if (name.includes('history')) {
      sqlite.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<100000)
        INSERT INTO attribute_vote_responses(response_id, attribute_id, subject_a_id, subject_b_id, comparison, activity_json, session_id, created_at, updated_at)
        SELECT 'history-' || i, ?, ?, ?, 'A_HIGHER', '[]', 'historical', 1, 1 FROM n`).run(attributeId, ids[0], ids[1]);
      sqlite.exec("UPDATE attribute_online_progress SET through_rowid = 100000, through_response_id = 'history-100000'");
    }
  } finally { sqlite.close(); }
}
const report = { scope: 'Local D1: baseline 45662e9 vs actual integrated publication, with/without index migration; includes receipt, scoring, indexes/triggers and cache publication; excludes common session middleware',
  scenarios: [], checks: [] };
const expectedStates = new Map();
mf = new Miniflare(options());
try {
  for (const scenario of scenarios) for (const variant of variants) {
    const name = `${variant}_${scenario.id.replaceAll('-', '_')}`;
    const m = modules[variant], raw = await mf.getD1Database(name, 'publication'), ids = idsByName.get(name);
    const control = m.createDatabase({ DB: raw });
    const clock = async () => (await raw.prepare('SELECT current_version FROM attribute_catalog_clock WHERE id = 1').first()).current_version;
    const sourceStates = async () => (await raw.prepare(`SELECT subject_id, attribute_id, score, rating_deviation,
      direct_sum, direct_count, comparison_count, decisive_comparison_count, evidence_count
      FROM attribute_score_states ORDER BY subject_id, attribute_id`).all()).results;
    const cursor = async () => (await raw.prepare('SELECT through_rowid FROM attribute_online_progress WHERE id = 1').first()).through_rowid;
    const startVersion = await clock();
    const cached = { generation: 1, generatedAt: 1, throughVersion: startVersion, subjects: await m.queryAttributeSubjects(control, ids),
      attributes: [], values: [], candidates: [], activities: [], scoreModelVersion: 'glicko-rd-v2' };
    const pull = async (initial) => {
      let cache = initial;
      for (let page = 0; page < 100; page++) {
        const result = await m.queryAttributeCatalogChanges(control, cache.throughVersion, 32);
        const delta = m.attributeCatalogChangesPayload(result, cache.throughVersion, { generation: 1, generatedAt: 1 }, 32);
        cache = m.applyAttributeCatalogChanges(cache, delta.changes, delta.throughVersion);
        if (!delta.hasMore) return cache;
      }
      throw new Error('Delta reader did not finish');
    };
    const verifyCache = async (initial) => {
      const cache = await pull(initial), states = await sourceStates();
      for (const s of states) {
        const expected = m.stateToMatrixValue(s.subject_id, s.attribute_id, { score: s.score, ratingDeviation: s.rating_deviation,
          directSum: s.direct_sum, directCount: s.direct_count, comparisonCount: s.comparison_count,
          decisiveComparisonCount: s.decisive_comparison_count, evidenceCount: s.evidence_count });
        assert.deepEqual(cache.values.find((v) => v.subjectId === s.subject_id && v.attributeId === s.attribute_id),
          JSON.parse(JSON.stringify(expected)), 'Existing frontend/parser must receive the exact new values');
      }
      return cache;
    };
    const requestDbs = [], sourceCosts = [], publicationCosts = [];
    const input = (i) => {
      const players = scenario.disjoint ? ids.slice(i * 6, i * 6 + 6) : ids.slice(0, scenario.pair ? 2 : 6);
      return { attributeId, subjectAId: players[0], subjectBId: players[1], responseId: 'research-' + i,
        actorId: null, sessionId: 'research-person-' + i, timestamp: Date.now(),
        ...(scenario.pair ? { comparison: 'A_HIGHER', ...(scenario.direct ? { ratingA: 7.25, ratingB: 2.5 } : {}) }
          : { ranking: { version: 1, orderedSubjectIds: players, referenceSubjectIds: [] } }) };
    };
    const post = async (i) => {
      const db = m.createDatabase({ DB: raw }); requestDbs.push(db);
      await m.saveAttributeResponse(db, input(i)); const source = db.metrics(); sourceCosts.push(source);
      await m.flushCatalogOutbox(db); const after = db.metrics();
      publicationCosts.push({ reads: after.rowsRead - source.rowsRead, writes: after.rowsWritten - source.rowsWritten });
    };
    if (scenario.concurrent) await Promise.all(Array.from({ length: 10 }, (_, i) => post(i)));
    else for (let i = 0; i < 10; i++) await post(i);
    assert.equal(await m.hasPendingAttributeResponses(control), false);
    assert.equal((await raw.prepare("SELECT COUNT(*) AS n FROM attribute_vote_responses WHERE session_id LIKE 'research-person-%'").first()).n, 10);
    const states = await sourceStates();
    if (variant === 'current') expectedStates.set(scenario.id, states);
    else assert.deepEqual(states, expectedStates.get(scenario.id), 'Scoring must be unchanged');
    const cache = await verifyCache(cached);
    if (variant.startsWith('inline')) {
      const byId = (rows) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
      assert.deepEqual(byId(cache.subjects), byId(cached.subjects), 'Score deltas must preserve all cached metadata');
    }
    const totals = requestDbs.reduce((sum, db) => { const s = db.metrics(); return { reads: sum.reads + s.rowsRead, writes: sum.writes + s.rowsWritten, sql: sum.sql + s.queries }; }, { reads: 0, writes: 0, sql: 0 });
    const item = { scenario: scenario.id, variant, votes: 10, ...totals,
      sourceReads: sourceCosts.reduce((n, s) => n + s.rowsRead, 0), sourceWrites: sourceCosts.reduce((n, s) => n + s.rowsWritten, 0),
      publicationReads: publicationCosts.reduce((n, s) => n + s.reads, 0), publicationWrites: publicationCosts.reduce((n, s) => n + s.writes, 0) };
    report.scenarios.push(item); console.log(JSON.stringify(item));
    assert.deepEqual((await raw.prepare('PRAGMA foreign_key_check(attribute_score_states)').all()).results, []);
    if (variant.startsWith('inline') && scenario.id === 'ranking-serial') {
      const before = { states: await sourceStates(), cursor: await cursor(), clock: await clock() };
      await raw.prepare(`CREATE TRIGGER research_fail BEFORE INSERT ON attribute_catalog_entries
        WHEN NEW.entry_key LIKE 'value:%' BEGIN SELECT RAISE(ABORT, 'research cache failure'); END`).run();
      const failed = await m.saveAttributeResponse(control, input(10));
      assert.equal(failed.scoreStatus, 'pending');
      assert.deepEqual({ states: await sourceStates(), cursor: await cursor(), clock: await clock() }, before);
      assert.equal((await raw.prepare('SELECT COUNT(*) AS n FROM attribute_catalog_rebuild_mode').first()).n, 0);
      assert.equal((await raw.prepare('SELECT COUNT(*) AS n FROM attribute_vote_responses WHERE response_id = ?').bind('research-10').first()).n, 1);
      await raw.prepare('DROP TRIGGER research_fail').run(); await m.processAttributeResponses(control);
      await verifyCache(cache);
      report.checks.push({ variant, publicationFailureRollsBackScoreCursorClock: true, durableVoteSurvives: true, serverOnlyRecoveryWorks: true });
      // Exercise the actual outbox publisher, not a separate prototype gate.
      await raw.prepare("UPDATE attribute_subjects SET display_name = display_name || ' research' WHERE id = ?").bind(ids[0]).run();
      const originalBatch = control.batch.bind(control);
      control.batch = async (statements) => {
        control.batch = originalBatch;
        await m.saveAttributeResponse(control, input(11));
        return originalBatch(statements);
      };
      assert.deepEqual(await m.flushCatalogOutbox(control), { processed: {} });
      assert(await raw.prepare("SELECT 1 FROM catalog_change_outbox WHERE catalog = 'attribute-subject' AND entity_key = ?").bind(ids[0]).first());
      await m.flushCatalogOutbox(control); await verifyCache(cache);
      report.checks.push({ variant, staleSubjectBundleRejected: true, metadataJobRetainedUntilFreshPublication: true });
      await raw.prepare("UPDATE attribute_subjects SET display_name = display_name || ' snapshot' WHERE id = ?").bind(ids[0]).run();
      const beforeSnapshot = await clock();
      control.batch = async (statements) => {
        control.batch = originalBatch;
        await m.runCompleteAttributeReplay(control);
        assert.equal(await clock(), beforeSnapshot, 'Full replay can replace the snapshot without advancing the delta clock');
        return originalBatch(statements);
      };
      assert.deepEqual(await m.flushCatalogOutbox(control), { processed: {} });
      await m.flushCatalogOutbox(control);
      await verifyCache(m.attributeCatalogPayload(await m.queryAttributeCatalogSnapshot(control)));
      report.checks.push({ variant, fullReplayGenerationChangeRejectsStaleBundle: true });
    }
    writeFileSync(resolve('.wrangler/attribute-publication-research.json'), JSON.stringify(report, null, 2));
  }
} finally { await mf.dispose(); }
