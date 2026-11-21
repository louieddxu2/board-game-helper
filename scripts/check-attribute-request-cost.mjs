// Actual HTTP middleware + isolated Miniflare D1; never accesses production.
// node scripts/check-attribute-request-cost.mjs [--baseline=<commit> | --compare-ranking-model] [scenario ...]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from '../node_modules/wrangler/node_modules/miniflare/dist/src/index.js';
import { bidirectionalCostVariant } from './ranking-research/cost-variant.mjs';

const cases = [
  { id: 'pair-guest', pair: true, budget: [68, 19] },
  { id: 'pair-member', pair: true, member: true, budget: [73, 19] },
  { id: 'pair-editor-direct', pair: true, member: true, editor: true, direct: true, budget: [78, 20] },
  { id: 'ranking-guest', budget: [128, 33] },
  { id: 'ranking-member', member: true, budget: [133, 33] },
  { id: 'ranking-many-users', member: true, manyUsers: true, budget: [133, 33] },
  { id: 'ranking-editor-references', member: true, editor: true, references: true, budget: [138, 33] },
  { id: 'ranking-metadata', dirty: true, budget: [183, 34] },
  { id: 'ranking-concurrent', concurrent: true, budget: [103, 22] },
  { id: 'ranking-mixed', concurrent: true, mixed: true, budget: [153, 27] },
  { id: 'ranking-disjoint', concurrent: true, disjoint: true, budget: [178, 67] },
  { id: 'ranking-history', concurrent: true, history: true, budget: [103, 22] },
  { id: 'ranking-large', large: true, budget: [2003, 352] },
];
const args = process.argv.slice(2);
const baseline = args.find((arg) => arg.startsWith('--baseline='))?.slice(11);
const compareRankingModel = args.includes('--compare-ranking-model');
assert(!baseline || /^[a-f0-9]{7,40}$/.test(baseline), 'Invalid baseline SHA');
assert(!baseline || !compareRankingModel, 'Choose a historical baseline or a ranking model comparison');
const selected = args.filter((arg) => !arg.startsWith('--baseline=') && arg !== '--compare-ranking-model');
assert(selected.every((id) => cases.some((c) => c.id === id)), 'Unknown scenario');
const scenarios = cases.filter((c) => !selected.length || selected.includes(c.id));
const variants = baseline ? ['baseline', 'optimized'] : compareRankingModel ? ['optimized', 'bidirectional'] : ['optimized'];
mkdirSync('.wrangler', { recursive: true });
const scratch = mkdtempSync(resolve('.wrangler/attribute-request-cost-'));
const absolute = (path) => resolve(path).replaceAll('\\', '/');
const entry = join(scratch, 'entry.ts');
writeFileSync(entry, `export { app } from '${absolute('worker/index.ts')}';\n`);
const modules = {};
// Node cannot load the Workers runtime module; the cost check only uses the app.
const workersRuntimeStub = { name: 'workers-runtime-stub', setup(b) {
  b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: resolve('worker/testing/cloudflareWorkersStub.ts') }));
} };
for (const variant of variants) {
  const outfile = join(scratch, variant + '.mjs');
  await build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'esm',
    plugins: [workersRuntimeStub, ...(variant === 'bidirectional' ? [bidirectionalCostVariant] : []),
      ...(variant !== 'baseline' ? [] : [{ name: 'historical-source', setup(b) {
      b.onLoad({ filter: /[\\/](?:worker|src[\\/]shared)[\\/].*\.ts$/ }, ({ path }) => ({
        contents: execFileSync('git', ['-c', 'core.fsmonitor=false', 'show',
          `${baseline}:${relative(process.cwd(), path).replaceAll('\\', '/')}`], { encoding: 'utf8' }),
        loader: 'ts', resolveDir: dirname(path),
      }));
    } }])],
  });
  modules[variant] = await import(pathToFileURL(outfile).href);
}
const names = scenarios.flatMap((s) => variants.map((v) => `${v}_${s.id.replaceAll('-', '_')}`));
const options = () => ({ ...convertV4MiniflareOptions({ name: 'cost', modules: true,
  script: 'export default {}', compatibilityDate: '2026-07-22', cf: false,
  d1Databases: Object.fromEntries(names.map((name) => [name, name])),
}), resourcePersistencePath: scratch, isolatedResourcePersistencePath: join(scratch, 'isolated'),
unsafeDevRegistryPath: join(scratch, 'registry'), unsafeEnableSharedStorage: true });
let mf = new Miniflare(options());
for (const name of names) await (await mf.getD1Database(name, 'cost')).prepare(`CREATE TABLE cost_${name}(id INTEGER)`).run();
await mf.dispose();
const migrations = readdirSync('migrations').filter((n) => n.endsWith('.sql')).sort();
const historicalMigrations = baseline ? new Set(execFileSync('git', ['ls-tree', '-r', '--name-only', baseline, '--', 'migrations'],
  { encoding: 'utf8' }).trim().split('\n').map((p) => p.replace('migrations/', ''))) : null;
const idsByName = new Map();
const token = 'attribute-cost-fixture-token';
const attributeId = 'attribute_setup_variability';
for (const file of readdirSync(join(scratch, 'd1/miniflare-D1DatabaseObject')).filter((n) => n.endsWith('.sqlite') && n !== 'metadata.sqlite')) {
  const db = new DatabaseSync(join(scratch, 'd1/miniflare-D1DatabaseObject', file));
  try {
    const name = names.find((n) => db.prepare('SELECT 1 FROM sqlite_schema WHERE name = ?').get('cost_' + n));
    if (!name) continue;
    for (const migration of migrations) {
      if (name.startsWith('baseline_') && !historicalMigrations.has(migration)) continue;
      db.exec(readFileSync(join('migrations', migration), 'utf8'));
    }
    db.exec(`DELETE FROM attribute_vote_responses; DELETE FROM attribute_score_states; DELETE FROM catalog_change_outbox;
      UPDATE attribute_online_progress SET through_rowid = 0, through_response_id = NULL;`);
    const ids = db.prepare(`SELECT subject.id FROM attribute_subjects subject
      JOIN attribute_votable_subjects votable ON votable.subject_id = subject.id
      WHERE subject.kind = 'game' ORDER BY subject.id LIMIT 100`).all().map((r) => r.id);
    assert.equal(ids.length, 100); idsByName.set(name, ids);
    db.prepare(`INSERT INTO users (id, google_sub, email, email_normalized, created_at, last_login_at, nickname, show_nickname)
      VALUES ('cost-user', 'cost-user', 'cost@example.invalid', 'cost@example.invalid', 1, 1, '測試暱稱', 1)`).run();
    db.prepare(`INSERT INTO sessions (id_hash, user_id, created_at, expires_at, last_seen_at)
      VALUES (?, 'cost-user', 1, ?, 1)`).run(createHash('sha256').update(token).digest('hex'), Date.now() + 86400_000);
    if (name.includes('many_users')) db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<5000)
      INSERT INTO users(id,google_sub,email,email_normalized,created_at,last_login_at)
      SELECT 'cost-extra-'||i, 'cost-extra-'||i, 'cost-extra-'||i||'@example.invalid', 'cost-extra-'||i||'@example.invalid', 1, 1 FROM n`);
    if (name.includes('editor')) db.exec("INSERT INTO user_roles(user_id, role, granted_by, granted_at) VALUES('cost-user', 'editor', 'cost-user', 1)");
    if (name.includes('history')) {
      db.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<100000)
        INSERT INTO attribute_vote_responses(response_id, attribute_id, subject_a_id, subject_b_id, comparison, activity_json, session_id, created_at, updated_at)
        SELECT 'history-' || i, ?, ?, ?, 'A_HIGHER', '[]', 'historical', 1, 1 FROM n`).run(attributeId, ids[0], ids[1]);
      db.exec("UPDATE attribute_online_progress SET through_rowid = 100000, through_response_id = 'history-100000'");
    }
    if (name.includes('metadata')) db.prepare("UPDATE attribute_subjects SET display_name = display_name || ' cost' WHERE id = ?").run(ids[0]);
  } finally { db.close(); }
}

const phaseFor = (sql) => /FROM sessions|SELECT role FROM user_roles/.test(sql) ? 'session'
  : /catalog_change_outbox/.test(sql) ? 'outbox'
    : /attribute_catalog_clock|INSERT INTO attribute_catalog_entries/.test(sql) ? 'deltas'
      : /INSERT INTO attribute_vote_responses|COUNT\(\*\) FROM|SELECT response_id FROM attribute_vote_responses WHERE response_id/.test(sql) ? 'receipt'
        : /attribute_translations|SELECT nickname/.test(sql) ? 'metadata'
          : /attribute_vote_lock/.test(sql) ? 'lease' : 'scoring';
const measuredDatabase = (raw) => {
  const events = [];
  const record = (sql, result) => {
    events.push({ phase: phaseFor(sql), query: sql.replace(/\s+/g, ' ').trim().slice(0, 120),
      reads: Number(result.meta?.rows_read ?? 0), writes: Number(result.meta?.rows_written ?? 0) });
    return result;
  };
  const wrap = (statement, sql) => ({
    raw: statement, sql,
    bind: (...values) => wrap(statement.bind(...values), sql),
    all: async () => record(sql, await statement.all()),
    run: async () => record(sql, await statement.run()),
    first: async () => record(sql, await statement.all()).results?.[0] ?? null,
  });
  return { events, DB: {
    prepare: (sql) => wrap(raw.prepare(sql), sql),
    batch: async (statements) => (await raw.batch(statements.map((s) => s.raw))).map((result, i) => record(statements[i].sql, result)),
  } };
};
const totals = (events) => events.reduce((s, e) => ({ reads: s.reads + e.reads, writes: s.writes + e.writes, sql: s.sql + 1 }), { reads: 0, writes: 0, sql: 0 });
const report = { baseline: baseline ?? null, compareRankingModel,
  scope: 'Whole HTTP request including real session/roles, receipt, scoring, indexes/triggers, publication and final flush; fixture setup/checks excluded', scenarios: [] };
const expected = new Map();
const scoreShape = (states) => states.map(({ score, rating_deviation, ...other }) => other);
mf = new Miniflare(options());
try {
  for (const scenario of scenarios) for (const variant of variants) {
    const name = `${variant}_${scenario.id.replaceAll('-', '_')}`, raw = await mf.getD1Database(name, 'cost');
    const app = modules[variant].app, ids = idsByName.get(name), events = [];
    const input = (i) => {
      const players = scenario.disjoint ? ids.slice(i * 6, i * 6 + 6) : ids.slice(0, scenario.pair ? 2 : scenario.large ? 100 : 6);
      return { attributeId: scenario.mixed && i % 2 ? 'attribute_win_method' : attributeId,
        subjectAId: players[0], subjectBId: players[1], responseId: `cost-response-${i}`, sessionId: `cost-person-${i}`,
        ...(scenario.pair ? { comparison: 'A_HIGHER', ...(scenario.direct ? { ratingA: 8, ratingB: 2 } : {}) }
          : { ranking: { version: 1, orderedSubjectIds: scenario.references ? [ids[6], ...players, ids[7]] : players,
            referenceSubjectIds: scenario.references ? [ids[6], ids[7]] : [] } }) };
    };
    const post = async (i) => {
      const meter = measuredDatabase(raw);
      const response = await app.request('https://cost.test/api/attributes/responses', {
        method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://cost.test',
          ...(scenario.member ? { cookie: `wbr_session=${token}` } : {}) }, body: JSON.stringify(input(i)),
      }, { DB: meter.DB, APP_ORIGIN: 'https://cost.test',
        PUBLIC_RATE_LIMITER: { limit: async () => ({ success: true }) }, WRITE_RATE_LIMITER: { limit: async () => ({ success: true }) } });
      const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body));
      assert(body.activities.every((a) => a.actorName === (scenario.member ? '測試暱稱' : '匿名玩家')));
      if (variant !== 'baseline') {
        const cost = totals(meter.events);
        assert.equal(Number(response.headers.get('X-D1-Rows-Read')), cost.reads, 'HTTP read header omits request work');
        assert.equal(Number(response.headers.get('X-D1-Rows-Written')), cost.writes, 'HTTP write header omits request work');
      }
      events.push(...meter.events);
    };
    if (scenario.concurrent) await Promise.all(Array.from({ length: 10 }, (_, i) => post(i)));
    else for (let i = 0; i < 10; i++) await post(i);
    assert.equal((await raw.prepare("SELECT COUNT(*) AS n FROM attribute_vote_responses WHERE response_id LIKE 'cost-response-%'").first()).n, 10);
    assert.equal((await raw.prepare(`SELECT 1 FROM attribute_vote_responses WHERE rowid >
      (SELECT through_rowid FROM attribute_online_progress WHERE id = 1) LIMIT 1`).first()), null);
    const states = (await raw.prepare(`SELECT subject_id, attribute_id, score, rating_deviation, direct_sum, direct_count,
      comparison_count, decisive_comparison_count, evidence_count FROM attribute_score_states ORDER BY subject_id, attribute_id`).all()).results;
    if (variant === 'bidirectional') {
      const current = expected.get(scenario.id);
      if (scenario.pair) assert.deepEqual(states, current, 'The research variant changed two-game voting');
      else {
        assert.deepEqual(scoreShape(states), scoreShape(current), 'Ranking model changed score targets or evidence counters');
        assert.notDeepEqual(states, current, 'The ranking scorer did not change the score or RD');
      }
    } else if (variant === 'baseline' || compareRankingModel) expected.set(scenario.id, states);
    else if (baseline) assert.deepEqual(states, expected.get(scenario.id), 'Whole-request optimization changed scoring');
    const cost = totals(events), phases = {};
    for (const phase of new Set(events.map((e) => e.phase))) phases[phase] = totals(events.filter((e) => e.phase === phase));
    const queries = {};
    for (const query of new Set(events.map((e) => e.query))) queries[query] = totals(events.filter((e) => e.query === query));
    const item = { scenario: scenario.id, variant, votes: 10, ...cost, phases };
    if (variant !== 'baseline') {
      assert(cost.reads / 10 <= scenario.budget[0], `${scenario.id}: ${cost.reads / 10} reads exceed ${scenario.budget[0]}`);
      assert(cost.writes / 10 <= scenario.budget[1], `${scenario.id}: ${cost.writes / 10} writes exceed ${scenario.budget[1]}`);
    }
    report.scenarios.push({ ...item, queries }); console.log(JSON.stringify(item));
    const filename = compareRankingModel ? 'attribute-ranking-model-cost.json' : 'attribute-request-cost.json';
    writeFileSync(resolve('.wrangler', filename), JSON.stringify(report, null, 2));
  }
} finally { await mf.dispose(); }
