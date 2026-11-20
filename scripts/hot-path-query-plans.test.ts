// @vitest-environment node
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { app } from '../worker';
import { NICKNAME_LOOKUP_BATCH_SIZE, resolvePublicNicknames, type RuleRow } from '../worker/routes/shared';
import { queryRecentActivities } from '../worker/data/attributeActivityFeed';
import { createHarness } from './attributeReplayTestHarness';

// Seed-era statistics made SQLite scan users for joins and IN lookups. With
// thousands of members every such request would read the whole table.
const setup = () => {
  const h = createHarness();
  h.sqlite.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<5000)
    INSERT INTO users(id, google_sub, email, email_normalized, created_at, last_login_at, nickname, show_nickname)
    SELECT 'plan-user-'||i, 'plan-user-'||i, 'plan-user-'||i||'@example.invalid', 'plan-user-'||i||'@example.invalid', 1, 1,
      '暱稱'||i, i % 2 FROM n;
    INSERT INTO user_roles(user_id, role, granted_by, granted_at) VALUES('plan-user-1', 'admin', 'plan-user-1', 1);`);
  const token = 'plan-fixture-token';
  h.sqlite.prepare('INSERT INTO sessions(id_hash,user_id,created_at,expires_at,last_seen_at) VALUES(?,?,1,?,1)')
    .run(createHash('sha256').update(token).digest('hex'), 'plan-user-1', Date.now() + 86400_000);
  h.sqlite.exec('PRAGMA foreign_keys = OFF');
  h.sqlite.exec(`INSERT INTO games(id, slug, display_name, normalized_name, created_at, updated_at, visibility, reviewed_by, created_by)
      VALUES('plan-game', 'plan-game', '計畫遊戲', '計畫遊戲', 1, 1, 'public', 'plan-user-2', 'plan-user-1');
    INSERT INTO rules(id, submission_id, game_id, statement, created_at, updated_at, created_by, status)
      VALUES('plan-rule', 'plan-submission', 'plan-game', '規則', 1, 1, 'plan-user-1', 'published');
    INSERT INTO rule_revisions(id, rule_id, previous_json, edited_by, created_at)
      VALUES('plan-revision', 'plan-rule', '{}', 'plan-user-3', 1);`);
  h.sqlite.exec('PRAGMA foreign_keys = ON');
  const get = (path: string) => app.request(`https://plan.test${path}`, { headers: { cookie: `wbr_session=${token}` } },
    { ...h.env, APP_ORIGIN: 'https://plan.test', PUBLIC_RATE_LIMITER: { limit: async () => ({ success: true }) },
      WRITE_RATE_LIMITER: { limit: async () => ({ success: true }) } });
  const plan = (sql: string): string[] => h.sqlite.prepare('EXPLAIN QUERY PLAN ' + sql).all()
    .map((row: { detail: unknown }) => String(row.detail));
  return { ...h, get, plan };
};

const userScans = (h: ReturnType<typeof setup>) => Array.from(new Set(h.executedSql))
  .filter((sql) => /\busers\b/.test(sql))
  .flatMap((sql) => {
    const aliases = ['users', ...Array.from(sql.matchAll(/\busers\s+(?:AS\s+)?(\w+)/gi), (m) => m[1])]
      .filter((alias) => !/^(INDEXED|ON|WHERE)$/i.test(alias));
    return h.plan(sql).filter((detail) => aliases.some((alias) => new RegExp(`^SCAN ${alias}\\b`).test(detail)))
      .map((detail) => `${detail} :: ${sql.replace(/\s+/g, ' ').trim().slice(0, 100)}`);
  });

test('public and account pages look members up by primary key', async () => {
  const h = setup();
  for (const path of ['/api/games/plan-game', '/api/rules/plan-rule/revisions', '/api/account/modified-rules',
    '/api/admin/review/batches', '/api/admin/review/proposals']) {
    h.executedSql.length = 0;
    const response = await h.get(path);
    expect(response.status, path).toBe(200);
    expect(h.executedSql.some((sql) => /\busers\b/.test(sql)), path).toBe(true);
    expect(userScans(h), path).toEqual([]);
  }
});

// Every-visit pages must stay on indexes: no base-table scans, except walking
// the newest-rule-heads index, which stops at its LIMIT.
const allowedScan = /^SCAN (views|recent|\(subquery|json_each|CONSTANT|head USING INDEX idx_game_public_rule_heads_recent$)/;
const tableScans = (h: ReturnType<typeof setup>) => Array.from(new Set(h.executedSql)).flatMap((sql) => h.plan(sql)
  .filter((detail) => /^SCAN /.test(detail) && !allowedScan.test(detail))
  .map((detail) => `${detail} :: ${sql.replace(/\s+/g, ' ').trim().slice(0, 100)}`));

test('home, personal home and exact game lookup read only indexed rows', async () => {
  const h = setup();
  h.sqlite.exec(`INSERT INTO game_daily_view_counts(game_id, view_date, view_count, last_view_at)
      VALUES('plan-game', DATE('now'), 3, 1);
    INSERT INTO user_game_favorites(user_id, game_id, created_at) VALUES('plan-user-1', 'plan-game', 1);`);
  for (const path of ['/api/home', '/api/account/home', `/api/games/resolve?name=${encodeURIComponent('計畫遊戲')}`]) {
    h.executedSql.length = 0;
    const response = await h.get(path);
    expect(response.status, path).toBe(200);
    expect(tableScans(h), path).toEqual([]);
  }
  const resolved = await (await h.get(`/api/games/resolve?name=${encodeURIComponent('計畫遊戲')}`)).json() as { game: { id: string } | null };
  expect(resolved.game?.id).toBe('plan-game');
});

test('contributor nickname lookups stay within the D1 parameter limit', async () => {
  const h = setup();
  const editors = Array.from({ length: 250 }, (_, i) => `plan-user-${i + 1}`);
  const rows = [{ created_by: 'plan-user-4999', reviewed_by: null, editor_ids_json: JSON.stringify(editors) }] as unknown as RuleRow[];
  h.executedSql.length = 0;
  const nicknames = await resolvePublicNicknames(h.gateway, rows);
  const lookups = h.executedSql.filter((sql) => /FROM users/.test(sql));
  expect(lookups.length).toBe(Math.ceil(251 / NICKNAME_LOOKUP_BATCH_SIZE));
  for (const sql of lookups) {
    expect(sql.split('?').length - 1).toBeLessThanOrEqual(100);
    expect(h.plan(sql).join('\n')).toContain('SEARCH users USING INDEX sqlite_autoindex_users_1');
  }
  expect(nicknames.size).toBe(126);
  expect(nicknames.get('plan-user-1')).toBe('暱稱1');
  expect(nicknames.get('plan-user-4999')).toBe('暱稱4999');
  expect(nicknames.has('plan-user-2')).toBe(false);
});

test('recent activity skips inactive-attribute votes only within a bounded recent window', async () => {
  const h = setup();
  h.sqlite.exec(`DELETE FROM attribute_vote_responses;
    UPDATE attributes SET is_active = 0 WHERE id = 'attribute_win_method';
    UPDATE attributes SET is_active = 1 WHERE id = 'attribute_setup_variability';`);
  const [a, b] = h.sqlite.prepare('SELECT id FROM attribute_subjects ORDER BY id LIMIT 2').all().map((row: { id: unknown }) => String(row.id));
  const activity = (id: string) => JSON.stringify([{ id, kind: 'comparison', actorName: '玩家', attributeId: 'x', attributeName: 'x',
    subjectA: { id: a, name: 'A' }, subjectB: { id: b, name: 'B' }, result: 'A_HIGHER', createdAt: 1 }]);
  const insert = h.sqlite.prepare(`INSERT INTO attribute_vote_responses(response_id, attribute_id, subject_a_id, subject_b_id,
    comparison, activity_json, session_id, created_at, updated_at) VALUES(?, ?, ?, ?, 'A_HIGHER', ?, 'plan', ?, ?)`);
  for (let i = 0; i < 6; i++) insert.run(`active-${i}`, 'attribute_setup_variability', a, b, activity(`active-${i}`), 100 + i, 100 + i);
  for (let i = 0; i < 3; i++) insert.run(`inactive-${i}`, 'attribute_win_method', a, b, activity(`inactive-${i}`), 200 + i, 200 + i);
  h.executedSql.length = 0;
  const activities = await queryRecentActivities(h.gateway);
  expect(activities.map((item) => item.responseId)).toEqual(['active-5', 'active-4', 'active-3', 'active-2', 'active-1']);
  const plan = h.plan(h.executedSql.at(-1)!).join('\n');
  expect(plan).toContain('SCAN attribute_vote_responses USING INDEX idx_attribute_vote_responses_recent');
  expect(plan).not.toContain('TEMP B-TREE');
  expect(h.executedSql.at(-1)).toMatch(/LIMIT 50\b/);
});
