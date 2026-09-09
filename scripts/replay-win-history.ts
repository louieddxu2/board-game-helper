// Operator-only runner: use the same replay implementation as the Worker.
// Wrangler keeps credentials private; no API tokens are read or printed here.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database, DatabaseStatement } from '../worker/data/database';
import { processAttributeMergeRebuildJobs } from '../worker/data/attributes';
import { replayAttributeResponses, type AttributeResponseReplayRecord, type OnlineAttributeState } from '../worker/data/attributeScoring';

const apply = process.argv.includes('--apply');
if (!apply && !process.argv.includes('--verify')) throw new Error('Pass --apply to rebuild production, or --verify for a read-only replay comparison.');
const literal = (value: unknown) => value == null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const execute = (args: string[]) => {
  const output = execFileSync(process.execPath, [
  'node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'board-game-rules-prod',
  '--remote', '--config', 'wrangler.production.jsonc', '--json', ...args,
], { encoding: 'utf8', env: { ...process.env, XDG_CONFIG_HOME: '.wrangler/xdg', CI: 'true' }, maxBuffer: 16 * 1024 * 1024 });
  // File import prints progress before its JSON, and batches need no returned rows.
  return args.includes('--file') ? [] : JSON.parse(output);
};
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
if (apply) await processAttributeMergeRebuildJobs(db, Date.now(), 100);
const job = await db.statement("SELECT status,error_message FROM attribute_merge_rebuild_jobs WHERE id='win-history-replay-v1'").first<{status:string;error_message:string|null}>();
console.log(JSON.stringify(job));
if (job?.status !== 'completed') throw new Error('Win-history replay did not complete.');

const history = await db.statement(`
  SELECT 'response:' || response_id AS responseId,created_at AS createdAt,attribute_id AS attributeId,
    subject_a_id AS subjectAId,subject_b_id AS subjectBId,rating_a AS ratingA,rating_b AS ratingB,comparison
  FROM attribute_vote_responses WHERE attribute_id='attribute_win_method'
  UNION ALL
  SELECT 'event:' || e.response_id || ':' || CASE WHEN e.kind='rating' THEN '1:' ELSE '2:' END || e.event_key || ':' || e.id,
    e.created_at,e.attribute_id,e.subject_a_id,e.subject_b_id,
    CASE WHEN e.kind='rating' THEN e.value ELSE NULL END,NULL,CASE WHEN e.kind='comparison' THEN e.result ELSE NULL END
  FROM attribute_vote_events e WHERE e.attribute_id='attribute_win_method'
    AND NOT EXISTS (SELECT 1 FROM attribute_vote_responses r WHERE r.response_id=e.response_id AND r.attribute_id IS NOT NULL)
`).all<AttributeResponseReplayRecord>();
const expected = replayAttributeResponses(history.results ?? []);
const actual = await db.statement(`SELECT subject_id,score,rating_deviation AS ratingDeviation,direct_sum AS directSum,
  direct_count AS directCount,comparison_count AS comparisonCount,decisive_comparison_count AS decisiveComparisonCount,evidence_count AS evidenceCount
  FROM attribute_score_states WHERE attribute_id='attribute_win_method' AND evidence_count>0`).all<OnlineAttributeState & {subject_id:string}>();
const fields = ['score','ratingDeviation','directSum','directCount','comparisonCount','decisiveComparisonCount','evidenceCount'] as const;
const mismatches = (actual.results ?? []).filter((row) => {
  const state = expected.get(`${row.subject_id}\u0000attribute_win_method`);
  return !state || fields.some((field) => Math.abs(row[field]-state[field]) > 1e-9);
});
console.log(JSON.stringify({replayRecords:history.results?.length,expectedSubjects:expected.size,storedSubjects:actual.results?.length,mismatches:mismatches.length}));
if (mismatches.length || expected.size !== actual.results?.length) throw new Error('Stored scores do not match a clean replay.');
