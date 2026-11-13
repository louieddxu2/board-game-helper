// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeAll, describe, expect, test } from 'vitest';
import type { Database, DatabaseStatement } from './database';
import { ensureRuleGameVariantStatements, resolveRuleBaseGame } from './gameEntities';

// Real schema, real triggers: an imported BGG expansion must stay part of its base game.
const sqlite = new DatabaseSync(':memory:');
const statement = (sql: string, params: unknown[] = []): DatabaseStatement => ({
  bind: (...values: unknown[]) => statement(sql, values),
  first: async () => (sqlite.prepare(sql).get(...(params as never[])) ?? null) as never,
  all: async () => ({ results: sqlite.prepare(sql).all(...(params as never[])), success: true, meta: {} }) as never,
  run: async () => {
    const result = sqlite.prepare(sql).run(...(params as never[]));
    return { results: [], success: true, meta: { changes: Number(result.changes) } } as never;
  },
});
const db: Database = {
  statement: (sql) => statement(sql),
  batch: async (items) => { const results = []; for (const item of items) results.push(await item.run()); return results; },
};
const rows = (sql: string) => sqlite.prepare(sql).all() as Array<Record<string, unknown>>;

beforeAll(() => {
  for (const file of readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'));
  }
  sqlite.exec(`
    INSERT INTO games (id, slug, display_name, english_name, normalized_name, created_at, updated_at, visibility, review_status, attribute_enabled, bgg_id, entity_kind)
    VALUES ('game_bgg_295947', 'bgg-295947', '卡斯卡迪亞之旅', 'Cascadia', '卡斯卡迪亞之旅', 1, 1, 'public', 'pending', 1, 295947, 'base'),
      ('game_bgg_314343', 'bgg-314343', '卡斯卡迪亞之旅：自然地標', 'Cascadia: Landmarks', '卡斯卡迪亞之旅自然地標', 1, 1, 'public', 'pending', 1, 314343, 'expansion');
    INSERT INTO game_aliases (id, game_id, alias, normalized_alias, alias_type, created_at)
    VALUES ('alias-landmarks', 'game_bgg_314343', '自然地標擴', '自然地標擴', 'alias', 1);
    INSERT INTO game_entity_relations (id, source_game_id, target_game_id, relation_type, created_at)
    VALUES ('relation-landmarks', 'game_bgg_314343', 'game_bgg_295947', 'expansion_of', 1);
  `);
  // Rule rows need a submission chain; these tests only exercise the variant link table.
  sqlite.exec('PRAGMA foreign_keys = OFF;');
});

describe('expansions on the rules site', () => {
  test('resolve to the base game they belong to', async () => {
    await expect(resolveRuleBaseGame(db, 'game_bgg_314343')).resolves.toEqual({
      id: 'game_bgg_295947', slug: 'bgg-295947', variantLabel: '卡斯卡迪亞之旅：自然地標',
    });
    await expect(resolveRuleBaseGame(db, 'game_bgg_295947')).resolves.toEqual({ id: 'game_bgg_295947', slug: 'bgg-295947' });
    await expect(resolveRuleBaseGame(db, 'missing')).resolves.toBeNull();
  });

  test('link rules to the imported expansion by name, English name or alias without new entities', async () => {
    for (const [ruleId, label] of [['rule-name', '卡斯卡迪亞之旅：自然地標'], ['rule-alias', '自然地標擴']]) {
      for (const item of await ensureRuleGameVariantStatements(db, 'game_bgg_295947', ruleId, [label], 2)) await item.run();
    }
    expect(rows("SELECT rule_id, game_id FROM rule_game_variants ORDER BY rule_id")).toEqual([
      { rule_id: 'rule-alias', game_id: 'game_bgg_314343' },
      { rule_id: 'rule-name', game_id: 'game_bgg_314343' },
    ]);
    // Entities created by this helper use the game_variant_ prefix; migration rows use game-variant-.
    expect(rows("SELECT id FROM games WHERE substr(id, 1, 13) = 'game_variant_'")).toEqual([]);
  });

  test('still keep a new label as a hidden entity of the base game', async () => {
    for (const item of await ensureRuleGameVariantStatements(db, 'game_bgg_295947', 'rule-new', ['Promo 卡'], 3)) await item.run();
    expect(rows(`SELECT g.visibility, g.entity_kind, r.relation_type FROM rule_game_variants v
      JOIN games g ON g.id = v.game_id JOIN game_entity_relations r ON r.source_game_id = g.id
      WHERE v.rule_id = 'rule-new'`)).toEqual([{ visibility: 'hidden', entity_kind: 'unknown', relation_type: 'variant_of' }]);
  });

  test('vote only as the base-plus-expansion setup, never as a standalone game', () => {
    expect(rows("SELECT kind FROM attribute_subjects WHERE game_id = 'game_bgg_314343'")).toEqual([]);
    expect(rows(`SELECT subject_id FROM attribute_votable_subjects
      WHERE subject_id = 'attribute_config_expansion:game_bgg_314343:game_bgg_295947'`)).toHaveLength(1);
  });
});
