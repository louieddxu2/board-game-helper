// @vitest-environment node
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';
import { buildMigratedSchema } from './check-d1-trigger-fanout.mjs';

const createFixture = () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE games (
      id TEXT PRIMARY KEY,
      published_rule_count INTEGER NOT NULL DEFAULT 0,
      total_rule_count INTEGER NOT NULL DEFAULT 0,
      latest_rule_updated_at INTEGER
    );
    CREATE TABLE rules (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'hidden')),
      review_status TEXT NOT NULL,
      created_by TEXT,
      pending_review_by TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE user_roles (
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      revoked_at INTEGER,
      PRIMARY KEY (user_id, role)
    );
    CREATE INDEX idx_user_roles_active_role ON user_roles(role, user_id);
    CREATE INDEX idx_rules_creator_pending_review
      ON rules(created_by, review_status, status);
    CREATE INDEX idx_rules_pending_review_by
      ON rules(pending_review_by, review_status, status, id);
    CREATE INDEX idx_rules_game_public_updated
      ON rules(game_id, status, updated_at DESC, id DESC);
  `);
  db.exec(readFileSync('migrations/0112_bound_trigger_lookups.sql', 'utf8'));
  return db;
};

test('reviewer quota counts authored and assigned rules once, including null authors', () => {
  const db = createFixture();
  try {
    const insert = db.prepare(`INSERT INTO rules
      (id, game_id, status, review_status, created_by, pending_review_by, updated_at)
      VALUES (?, 'game', ?, 'pending', ?, ?, 1)`);
    insert.run('a1', 'published', 'user', null);
    insert.run('a2', 'published', 'user', null);
    insert.run('b1', 'published', 'other', 'user');
    insert.run('b2', 'published', 'other', 'user');
    insert.run('both', 'published', 'user', 'user');
    insert.run('null-author', 'published', null, 'user');
    expect(() => insert.run('blocked', 'published', 'other', 'user'))
      .toThrow(/pending_rule_limit/u);

    insert.run('draft', 'draft', 'other', 'user');
    expect(() => db.exec("UPDATE rules SET status = 'published' WHERE id = 'draft'"))
      .toThrow(/pending_rule_limit/u);
    expect(db.prepare("SELECT status FROM rules WHERE id = 'draft'").get().status).toBe('draft');
  } finally { db.close(); }
});

test('deleting or moving a rule recomputes the remaining latest timestamp', () => {
  const db = createFixture();
  try {
    db.exec(`
      INSERT INTO games (id, published_rule_count, total_rule_count, latest_rule_updated_at)
        VALUES ('old', 1, 3, 30), ('new', 0, 0, NULL);
      INSERT INTO rules (id, game_id, status, review_status, updated_at) VALUES
        ('draft', 'old', 'draft', 'approved', 11),
        ('published', 'old', 'published', 'approved', 20),
        ('hidden', 'old', 'hidden', 'approved', 30);
      DELETE FROM rules WHERE id = 'hidden';
    `);
    const oldGame = () => db.prepare(`SELECT published_rule_count, total_rule_count,
      latest_rule_updated_at FROM games WHERE id = 'old'`).get();
    expect(oldGame()).toMatchObject({
      published_rule_count: 1, total_rule_count: 2, latest_rule_updated_at: 20,
    });
    db.exec("UPDATE rules SET game_id = 'new' WHERE id = 'published'");
    expect(oldGame()).toMatchObject({
      published_rule_count: 0, total_rule_count: 1, latest_rule_updated_at: 11,
    });
    db.exec("DELETE FROM rules WHERE id = 'draft'");
    expect(oldGame()).toMatchObject({
      published_rule_count: 0, total_rule_count: 0, latest_rule_updated_at: null,
    });
  } finally { db.close(); }
});

test('rule trigger lookups use the existing creator, reviewer, and game indexes', () => {
  const db = buildMigratedSchema();
  try {
    const quotaSql = `SELECT
      (SELECT COUNT(*) FROM rules WHERE created_by = ?
        AND review_status = 'pending' AND status = 'published') +
      (SELECT COUNT(*) FROM rules WHERE pending_review_by = ?
        AND created_by IS NOT ? AND review_status = 'pending' AND status = 'published')`;
    const quotaPlan = db.prepare(`EXPLAIN QUERY PLAN ${quotaSql}`).all('user', 'user', 'user')
      .map(({ detail }) => detail);
    expect(quotaPlan).toEqual(expect.arrayContaining([
      expect.stringContaining('USING COVERING INDEX idx_rules_creator_pending_review'),
      expect.stringContaining('USING INDEX idx_rules_pending_review_by'),
    ]));
    expect(quotaPlan.some((detail) => detail.includes('SCAN rules'))).toBe(false);

    const latestSql = `SELECT MAX(candidate) FROM (
      SELECT (SELECT updated_at FROM rules WHERE game_id = ? AND status = 'draft'
        ORDER BY updated_at DESC LIMIT 1) AS candidate
      UNION ALL SELECT (SELECT updated_at FROM rules WHERE game_id = ? AND status = 'published'
        ORDER BY updated_at DESC LIMIT 1)
      UNION ALL SELECT (SELECT updated_at FROM rules WHERE game_id = ? AND status = 'hidden'
        ORDER BY updated_at DESC LIMIT 1)
    )`;
    const latestPlan = db.prepare(`EXPLAIN QUERY PLAN ${latestSql}`).all('game', 'game', 'game')
      .map(({ detail }) => detail);
    expect(latestPlan.filter((detail) =>
      detail.includes('USING COVERING INDEX idx_rules_game_public_updated (game_id=? AND status=?)')))
      .toHaveLength(3);

    const adminPlan = db.prepare(`EXPLAIN QUERY PLAN SELECT 1 FROM user_roles
      WHERE role = 'admin' AND revoked_at IS NULL AND user_id <> ?`).all('user')
      .map(({ detail }) => detail);
    expect(adminPlan).toEqual([
      expect.stringContaining('USING COVERING INDEX idx_user_roles_active_role (role=? AND revoked_at=?)'),
    ]);
  } finally { db.close(); }
});
