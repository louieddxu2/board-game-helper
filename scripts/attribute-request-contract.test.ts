// @vitest-environment node
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { app } from '../worker';
import { saveAttributeResponse } from '../worker/data/attributeResponses';
import { processAttributeResponses } from '../worker/workflows/attributeOnlineScoring';
import { queryAttributeCatalogChanges } from '../worker/data/attributeCatalog';
import { createHarness } from './attributeReplayTestHarness';

const setup = () => {
  const h = createHarness();
  h.sqlite.exec(`DELETE FROM attribute_vote_responses; DELETE FROM attribute_score_states; DELETE FROM catalog_change_outbox;
    UPDATE attribute_online_progress SET through_rowid = 0, through_response_id = NULL;
    INSERT INTO users(id, google_sub, email, email_normalized, created_at, last_login_at, nickname, show_nickname)
      VALUES('contract-user', 'contract-user', 'contract@example.invalid', 'contract@example.invalid', 1, 1, '顯示暱稱', 1);`);
  const token = 'contract-fixture-token', hash = createHash('sha256').update(token).digest('hex');
  h.sqlite.prepare('INSERT INTO sessions(id_hash,user_id,created_at,expires_at,last_seen_at) VALUES(?,?,1,?,1)')
    .run(hash, 'contract-user', Date.now() + 86400_000);
  const ids = h.sqlite.prepare(`SELECT subject.id FROM attribute_subjects subject
    JOIN attribute_votable_subjects votable ON votable.subject_id = subject.id
    WHERE subject.kind = 'game' ORDER BY subject.id LIMIT 100`).all().map((row: { id: unknown }) => String(row.id));
  const input = (n: number, count = 6) => ({ attributeId: 'attribute_setup_variability', subjectAId: ids[0], subjectBId: ids[1],
    responseId: `contract-ballot-${n}`, sessionId: 'contract-session',
    ranking: { version: 1 as const, orderedSubjectIds: ids.slice(0, count), referenceSubjectIds: [] } });
  const post = (body: unknown, loggedIn = true) => app.request('https://contract.test/api/attributes/responses', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://contract.test',
      ...(loggedIn ? { cookie: `wbr_session=${token}` } : {}) }, body: JSON.stringify(body),
  }, { ...h.env, APP_ORIGIN: 'https://contract.test', EXPOSE_D1_METRICS: '1', PUBLIC_RATE_LIMITER: { limit: async () => ({ success: true }) },
    WRITE_RATE_LIMITER: { limit: async () => ({ success: true }) } });
  const receipt = (n: number) => h.sqlite.prepare('SELECT actor_id, online_weight, activity_json FROM attribute_vote_responses WHERE response_id = ?')
    .get(input(n).responseId)!;
  return { ...h, ids, hash, input, post, receipt };
};

test('real session data supplies nickname and roles; the next request sees revocation and privacy changes', async () => {
  const h = setup();
  try {
    h.sqlite.exec("INSERT INTO user_roles(user_id,role,granted_by,granted_at) VALUES('contract-user','editor','contract-user',1)");
    h.executedSql.length = 0;
    const response = await h.post({ ...h.input(0), actorName: '偽造名稱', actorId: 'spoof', actorIsAuthorized: false });
    expect(response.status).toBe(200);
    expect((await response.json()).activities.every((a: { actorName: string }) => a.actorName === '顯示暱稱')).toBe(true);
    expect(h.receipt(0)).toMatchObject({ actor_id: 'contract-user', online_weight: 2 });
    const sessionQuery = h.executedSql.filter((sql) => sql.includes('FROM sessions s'));
    expect(sessionQuery).toHaveLength(1);
    expect(h.sqlite.prepare('EXPLAIN QUERY PLAN ' + sessionQuery[0]).all(h.hash).map((row: { detail: unknown }) => row.detail).join('\n'))
      .toMatch(/SEARCH u USING INDEX sqlite_autoindex_users_1/);
    expect(h.executedSql.some((sql) => /LEFT JOIN users actor|SELECT nickname, show_nickname/.test(sql))).toBe(false);
    h.sqlite.exec("UPDATE user_roles SET revoked_at = 2 WHERE user_id = 'contract-user'; UPDATE users SET show_nickname = 0 WHERE id = 'contract-user'");
    expect((await h.post({ ...h.input(1), actorName: '偽造名稱', actorIsAuthorized: true })).status).toBe(200);
    expect(h.receipt(1)).toMatchObject({ actor_id: 'contract-user', online_weight: 1.5 });
    expect(JSON.parse(String(h.receipt(1).activity_json)).every((a: { actorName: string }) => a.actorName === '匿名玩家')).toBe(true);
    const before = h.sqlite.prepare('SELECT comparison_count FROM attribute_score_states ORDER BY subject_id').all();
    expect((await h.post(h.input(1))).status).toBe(200);
    expect(h.sqlite.prepare('SELECT comparison_count FROM attribute_score_states ORDER BY subject_id').all()).toEqual(before);
  } finally { h.sqlite.close(); }
});

test('an expired cookie becomes a guest and cannot spoof the actor snapshot', async () => {
  const h = setup();
  try {
    h.sqlite.prepare('UPDATE sessions SET expires_at = 1 WHERE id_hash = ?').run(h.hash);
    const response = await h.post({ ...h.input(0), actorName: '偽造名稱', actorId: 'contract-user', actorIsAuthorized: true });
    expect(response.status).toBe(200);
    expect(h.receipt(0)).toMatchObject({ actor_id: null, online_weight: 1 });
    expect((await response.json()).activities.every((a: { actorName: string }) => a.actorName === '匿名玩家')).toBe(true);
    expect(h.sqlite.prepare('SELECT 1 FROM sessions WHERE id_hash = ?').get(h.hash)).toBeUndefined();
    expect(Number(response.headers.get('X-D1-Rows-Written'))).toBeGreaterThan(0);
  } finally { h.sqlite.close(); }
});

test.each([98, 100])('ranking with %i players stays within bind limits and scores every adjacent comparison', async (count) => {
  const h = setup();
  try {
    const response = await h.post(h.input(0, count), false);
    expect(response.status).toBe(200);
    expect((await response.json()).activities).toHaveLength(count - 1);
    expect(h.sqlite.prepare('SELECT SUM(comparison_count) AS n FROM attribute_score_states').get()).toEqual({ n: 2 * (count - 1) });
    const scoring = h.executedSql.find((sql) => sql.includes('subject.id AS subject_id, attribute.id AS attribute_id'))!;
    expect(scoring.includes('json_each')).toBe(count === 100);
  } finally { h.sqlite.close(); }
});

test('internal receipt callers without a session snapshot still resolve nickname from the database once', async () => {
  const h = setup();
  try {
    h.executedSql.length = 0;
    const saved = await saveAttributeResponse(h.gateway, { ...h.input(0), actorId: 'contract-user', timestamp: Date.now() });
    expect(saved.activities.every((a) => a.actorName === '顯示暱稱')).toBe(true);
    expect(h.executedSql.filter((sql) => sql.includes('SELECT nickname, show_nickname'))).toHaveLength(1);
  } finally { h.sqlite.close(); }
});

test('a mixed-attribute batch preserves both rankings on the general target lookup path', async () => {
  const h = setup();
  try {
    h.sqlite.prepare("INSERT INTO attribute_vote_lock(lock_name,token,expires_at) VALUES('attribute-replay','hold',?)").run(Date.now() + 60_000);
    await saveAttributeResponse(h.gateway, { ...h.input(0), actorId: null, timestamp: Date.now() });
    await saveAttributeResponse(h.gateway, { ...h.input(1), subjectAId: h.ids[5], subjectBId: h.ids[4], attributeId: 'attribute_win_method', actorId: null, timestamp: Date.now() + 1,
      ranking: { ...h.input(1).ranking, orderedSubjectIds: [...h.input(1).ranking.orderedSubjectIds].reverse() } });
    h.sqlite.exec("DELETE FROM attribute_vote_lock WHERE token = 'hold'");
    expect(await processAttributeResponses(h.gateway)).toMatchObject({ status: 'processed', batches: 1 });
    const score = (subject: string, attribute: string) => Number(h.sqlite.prepare('SELECT score FROM attribute_score_states WHERE subject_id = ? AND attribute_id = ?').get(subject, attribute)!.score);
    expect(score(h.ids[0], 'attribute_setup_variability')).toBeGreaterThan(score(h.ids[5], 'attribute_setup_variability'));
    expect(score(h.ids[0], 'attribute_win_method')).toBeLessThan(score(h.ids[5], 'attribute_win_method'));
    expect(h.sqlite.prepare('SELECT attribute_id, SUM(comparison_count) AS n FROM attribute_score_states GROUP BY attribute_id ORDER BY attribute_id').all())
      .toEqual([{ attribute_id: 'attribute_setup_variability', n: 10 }, { attribute_id: 'attribute_win_method', n: 10 }]);
  } finally { h.sqlite.close(); }
});

test('catalog pagination keeps its unique version order after pruning the redundant index', async () => {
  const h = setup();
  try {
    expect(h.sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'idx_attribute_catalog_entries_version'").get()).toBeUndefined();
    const before = Number(h.sqlite.prepare('SELECT current_version FROM attribute_catalog_clock WHERE id = 1').get()!.current_version);
    await saveAttributeResponse(h.gateway, { ...h.input(0), actorId: null, timestamp: Date.now() });
    const first = await queryAttributeCatalogChanges(h.gateway, before, 3);
    const second = await queryAttributeCatalogChanges(h.gateway, Number(first.results!.at(-1)!.catalog_version), 3);
    const rows = [...first.results!, ...second.results!];
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((row) => row.entry_key)).size).toBe(6);
    expect(rows.map((row) => Number(row.catalog_version))).toEqual(Array.from({ length: 6 }, (_, i) => before + i + 1));
    expect(() => h.sqlite.prepare('INSERT INTO attribute_catalog_entries(entry_key,catalog_version,deleted,updated_at) VALUES(?,?,0,0)')
      .run('duplicate-version', rows[0].catalog_version)).toThrow(/UNIQUE/);
  } finally { h.sqlite.close(); }
});

test('the complete HTTP metrics include post-route outbox work and reject invalid payloads without flushing', async () => {
  const h = setup();
  try {
    // Synthetic per-statement metadata isolates the header contract from the
    // SQLite harness. Physical D1 budgets are checked by check:attribute-cost.
    const observed = { reads: 0, writes: 0 };
    const prepare = h.env.DB.prepare.bind(h.env.DB);
    const wrap = (statement: ReturnType<typeof prepare>): ReturnType<typeof prepare> => ({
      bind: (...values) => wrap(statement.bind(...values)),
      first: async <T>() => (await wrap(statement).all<T>()).results?.[0] ?? null,
      all: async <T>() => {
        const result = await statement.all<T>();
        const meta = { ...result.meta, rows_read: 3, rows_written: Number(result.meta?.changes ?? 0) };
        observed.reads += meta.rows_read; observed.writes += meta.rows_written;
        return { ...result, meta };
      },
      run: async <T>() => wrap(statement).all<T>(),
    });
    h.env.DB.prepare = (sql) => wrap(prepare(sql));
    h.sqlite.prepare("UPDATE attribute_subjects SET display_name = '待發布名稱' WHERE id = ?").run(h.ids[0]);
    const response = await h.post(h.input(0));
    expect(response.status).toBe(200);
    expect(response.headers.get('X-D1-Rows-Read')).toBe(String(observed.reads));
    expect(response.headers.get('X-D1-Rows-Written')).toBe(String(observed.writes));
    expect(h.sqlite.prepare('SELECT * FROM catalog_change_outbox').all()).toEqual([]);
    observed.reads = 0; observed.writes = 0; h.executedSql.length = 0;
    const rejected = await h.post({ ...h.input(1), ranking: { version: 1, orderedSubjectIds: [], referenceSubjectIds: [] } });
    expect(rejected.status).toBe(400);
    expect(rejected.headers.get('X-D1-Rows-Read')).toBe(String(observed.reads));
    expect(rejected.headers.get('X-D1-Rows-Written')).toBe('0');
    expect(h.executedSql.some((sql) => sql.includes('catalog_change_outbox'))).toBe(false);
  } finally { h.sqlite.close(); }
});
