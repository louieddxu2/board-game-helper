// Local Miniflare/D1 only. Run: node --import tsx scripts/benchmark-attribute-replay.ts [vote counts]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Miniflare, convertV4MiniflareOptions } from '../node_modules/wrangler/node_modules/miniflare/dist/src/index.js';
import { createDatabase } from '../worker/data/database';
import type { D1Database } from '../worker/env';
import { runCompleteAttributeReplay } from '../worker/workflows/attributeReplay';
import { resumePendingAttributeReplay } from '../worker/workflows/attributeResumableReplay';
import { runWeeklyAttributeRebuild } from '../worker/workflows/attributeWeeklyRebuild';

const counts = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [10_000, 50_000, 100_000];
assert(counts.every((count) => Number.isInteger(count) && count >= 4_000 && count <= 100_000));
const migrations = readdirSync('migrations').filter((file) => file.endsWith('.sql')).sort()
  .map((file) => readFileSync(join('migrations', file), 'utf8'));
const scratch = resolve('.wrangler');
mkdirSync(scratch, { recursive: true });
const directory = mkdtempSync(join(scratch, 'attribute-replay-benchmark-'));

const names = ['FULL', 'RESUMABLE'] as const;
type Name = typeof names[number];

const localRuntime = (root: string) => new Miniflare({
  ...convertV4MiniflareOptions({
    name: 'replay-benchmark', modules: true, script: 'export default {}', compatibilityDate: '2026-07-22',
    d1Databases: { FULL: 'full', RESUMABLE: 'resumable' }, cf: false,
  }),
  resourcePersistencePath: root,
  isolatedResourcePersistencePath: join(root, 'isolated'),
  unsafeDevRegistryPath: join(root, 'registry'),
  unsafeEnableSharedStorage: true,
});

const openLocal = (runtime: Miniflare, name: Name) =>
  runtime.getD1Database(name, 'replay-benchmark') as unknown as Promise<D1Database>;

function seed(file: string, count: number, timestamp: number): void {
  const sqlite = new DatabaseSync(file);
  try {
    for (const migration of migrations) sqlite.exec(migration);
    sqlite.exec('BEGIN; DELETE FROM attribute_vote_responses;');
    const game = sqlite.prepare(`
      INSERT INTO games (id, slug, display_name, normalized_name, created_at, updated_at,
        bgg_id, entity_kind, visibility, review_status, attribute_enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'base', 'public', 'pending', 1)
    `);
    for (let index = 0; index < 450; index += 1) {
      const id = `replay-benchmark-game-${String(index).padStart(3, '0')}`;
      game.run(id, id, id, id, timestamp, timestamp, 990_000 + index);
    }
    const subjects = sqlite.prepare(`
      SELECT id FROM attribute_subjects WHERE game_id GLOB 'replay-benchmark-game-*' ORDER BY id
    `).all().map(({ id }) => String(id));
    assert.equal(subjects.length, 450);
    const vote = sqlite.prepare(`
      INSERT INTO attribute_vote_responses
        (response_id, attribute_id, subject_a_id, subject_b_id, rating_a, comparison,
         activity_json, session_id, created_at, updated_at)
      VALUES (?, 'attribute_win_method', ?, ?, ?, ?, '[]', 'benchmark', ?, ?)
    `);
    let index = 0;
    for (let a = 0; a < subjects.length && index < count; a += 1) {
      for (let b = a + 1; b < subjects.length && index < count; b += 1) {
        const at = timestamp + (index * 17 % 491);
        const comparison = ['A_HIGHER', 'SIMILAR', 'B_HIGHER'][index % 3];
        vote.run(`bench-${String(index).padStart(6, '0')}`, subjects[a], subjects[b],
          index % 5 === 0 ? 1 + index % 9 : null, comparison, at, at);
        index += 1;
      }
    }
    assert.equal(index, count);
    sqlite.exec('DELETE FROM catalog_change_outbox; COMMIT;');
  } finally {
    sqlite.close();
  }
}

function publishedDigests(file: string): Record<string, string> {
  const sqlite = new DatabaseSync(file, { readOnly: true });
  try {
    const queries = {
      states: `SELECT subject_id, attribute_id, score, rating_deviation, direct_sum, direct_count, comparison_count,
        decisive_comparison_count, evidence_count, model_version
        FROM attribute_score_states ORDER BY subject_id, attribute_id`,
      pairs: `SELECT subject_a_id, subject_b_id, attribute_id, comparison_count
        FROM attribute_pair_stats ORDER BY subject_a_id, subject_b_id, attribute_id`,
      publicValues: `SELECT scores.value
        FROM attribute_catalog_snapshot_chunks, json_each(entries_json) AS entries,
          json_each(entries.value, '$.values') AS scores
        WHERE generation = (SELECT active_generation FROM attribute_catalog_snapshot_state WHERE id = 1)
        ORDER BY scores.value ->> 'subjectId', scores.value ->> 'attributeId'`,
    };
    assert.equal(sqlite.prepare('SELECT 1 FROM attribute_replay_work').get(), undefined);
    return Object.fromEntries(Object.entries(queries).map(([kind, sql]) => {
      const digest = createHash('sha256');
      for (const row of sqlite.prepare(sql).iterate()) digest.update(JSON.stringify(row) + '\n');
      return [kind, digest.digest('hex')];
    }));
  } finally {
    sqlite.close();
  }
}

try {
  for (const count of counts) {
    const root = join(directory, `votes-${count}`);
    let runtime = localRuntime(root);
    const timestamp = Date.now();
    try {
      for (const name of names) {
        const d1 = await openLocal(runtime, name);
        await d1.prepare(`CREATE TABLE benchmark_${name} (id INTEGER)`).run();
      }
    } finally {
      await runtime.dispose();
    }

    const d1Directory = join(root, 'd1', 'miniflare-D1DatabaseObject');
    const files = new Map<Name, string>();
    for (const entry of readdirSync(d1Directory).filter((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite')) {
      const file = join(d1Directory, entry);
      const sqlite = new DatabaseSync(file);
      try {
        for (const name of names) {
          if (sqlite.prepare('SELECT name FROM sqlite_schema WHERE name = ?').get(`benchmark_${name}`)) files.set(name, file);
        }
      } finally {
        sqlite.close();
      }
    }
    assert.equal(files.size, names.length);
    for (const file of files.values()) seed(file, count, timestamp);

    runtime = localRuntime(root);
    try {
      for (const name of names) {
        const raw = await openLocal(runtime, name);
        for (let invocation = 1; ; invocation += 1) {
          assert(invocation <= 20, 'Replay did not finish in 20 invocations');
          const db = createDatabase({ DB: raw });
          const startedAt = performance.now();
          let outcome;
          if (name === 'FULL') {
            await runCompleteAttributeReplay(db, timestamp + 1_000, { compareLiveStates: true });
            outcome = 'replay';
          } else if (invocation === 1) {
            outcome = await runWeeklyAttributeRebuild(db, timestamp + 1_000, { workBudget: {} });
          } else {
            outcome = await resumePendingAttributeReplay(db, timestamp + 1_000 + invocation);
          }
          console.log(JSON.stringify({
            votes: count, path: name, invocation, outcome, ms: Math.round(performance.now() - startedAt), ...db.metrics(),
          }));
          if (outcome === 'replay') break;
          assert.equal(outcome, 'pending');
        }
      }
    } finally {
      await runtime.dispose();
    }
    assert.deepEqual(publishedDigests(files.get('RESUMABLE')!), publishedDigests(files.get('FULL')!), 'Published results differ');
    console.log(JSON.stringify({ votes: count, publishedResultsMatch: true }));
  }
} finally {
  assert.equal(dirname(resolve(directory)), scratch);
  rmSync(directory, { recursive: true, force: true });
}
