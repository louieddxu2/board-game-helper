// @vitest-environment node
import { expect, test } from 'vitest';
import { ScorepadApi } from '../worker';
import { flushCatalogOutbox } from '../worker/data/catalogOutbox';
import { rebuildScorepadCatalog } from '../worker/data/scorepadSnapshot';
import { createHarness } from './attributeReplayTestHarness';

const setup = () => {
  const h = createHarness();
  const [base, merged, noBgg] = h.sqlite.prepare(`SELECT id, bgg_id FROM games WHERE visibility = 'public'
    AND merged_into_game_id IS NULL AND COALESCE(entity_kind, 'base') = 'base' AND bgg_id IS NOT NULL ORDER BY id LIMIT 3`)
    .all() as { id: string; bgg_id: number }[];
  h.sqlite.exec(`
    INSERT INTO games(id, slug, display_name, normalized_name, created_at, updated_at, visibility, review_status, entity_kind, bgg_id)
      VALUES('snap-expansion', 'snap-expansion', '快照擴充', '快照擴充', 1, 1, 'hidden', 'pending', 'expansion', 990020),
        ('snap-edition-only', 'snap-edition-only', '只有版本編號', '只有版本編號', 1, 1, 'hidden', 'pending', 'base', NULL);
    INSERT INTO game_entity_relations(id, source_game_id, target_game_id, relation_type, created_at)
      VALUES('snap-relation', 'snap-expansion', '${base.id}', 'expansion_of', 1);
    INSERT INTO game_external_ids(id, game_id, source, external_id, relation, created_at)
      VALUES('snap-external', 'snap-edition-only', 'bgg', '990021', 'primary', 1);
    INSERT INTO game_aliases(id, game_id, alias, normalized_alias, created_at)
      VALUES('snap-alias', 'snap-expansion', '快照別名', 'snap-alias', 1);
    UPDATE games SET merged_into_game_id = '${base.id}' WHERE id = '${merged.id}';
    UPDATE games SET bgg_id = NULL WHERE id = '${noBgg.id}';
    DELETE FROM game_external_ids WHERE game_id = '${noBgg.id}' AND source = 'bgg';`);
  const api = new ScorepadApi({}, h.env as never);
  const plan = (sql: string): string[] => h.sqlite.prepare('EXPLAIN QUERY PLAN ' + sql).all()
    .map((row: { detail: unknown }) => String(row.detail));
  const count = (table: string) => (h.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  return { ...h, api, plan, count, base, merged, noBgg };
};

const baseTableScans = (plan: string[]) => plan.filter((detail) => /^SCAN /.test(detail)
  && !/^SCAN (candidates|json_each|CONSTANT ROW|\(subquery)/.test(detail));

test('getScorepadCatalog returns every unmerged game with a BGG id, hidden ones included, with RuleRef', async () => {
  const h = setup();
  const result = await h.api.getScorepadCatalog();
  if (result.unchanged) throw new Error('expected games');
  expect(result.version).toMatch(/^[0-9a-f]{16}$/);
  const byId = new Map(result.games.map((game) => [game.gameId, game]));
  expect(byId.size).toBe(result.games.length);
  expect(result.games.every((game) => game.bggIds.length > 0)).toBe(true);
  expect(byId.has(h.merged.id)).toBe(false);
  expect(byId.has(h.noBgg.id)).toBe(false);
  const row = h.sqlite.prepare('SELECT published_rule_count, latest_rule_updated_at FROM games WHERE id = ?').get(h.base.id) as {
    published_rule_count: number | null; latest_rule_updated_at: number | null };
  expect(byId.get(h.base.id)).toEqual(expect.objectContaining({
    bggIds: [String(h.base.bgg_id)], ruleGameId: h.base.id, publishedRuleCount: Number(row.published_rule_count ?? 0),
    ruleVersion: (await h.api.getRuleSummaryByBgg(String(h.base.bgg_id)))!.ruleVersion,
  }));
  // A hidden expansion awaiting review leads to its base game and carries no count of its own.
  expect(byId.get('snap-expansion')).toEqual({
    gameId: 'snap-expansion', bggIds: ['990020'], displayName: '快照擴充', englishName: null, aliases: ['快照別名'], ruleGameId: h.base.id,
  });
  // A BGG id held only in game_external_ids is enough; a hidden base game has no rules here.
  expect(byId.get('snap-edition-only')).toEqual(expect.objectContaining({ bggIds: ['990021'], ruleGameId: null }));
  expect(h.count('scorepad_catalog_snapshot_chunks')).toBe(1);
});

test('the catalog query and the call reach every table through an index, and a current version reads one query', async () => {
  const h = setup();
  h.executedSql.length = 0;
  await rebuildScorepadCatalog(h.gateway, 1000);
  const catalogSql = h.executedSql.find((sql) => sql.includes('WITH candidates'))!;
  expect(baseTableScans(h.plan(catalogSql))).toEqual([]);
  const first = await h.api.getScorepadCatalog();
  h.executedSql.length = 0;
  expect(await h.api.getScorepadCatalog(first.version)).toEqual({ unchanged: true, version: first.version });
  expect(h.executedSql).toHaveLength(1);
  expect(h.plan(h.executedSql[0]).filter((detail) => /^SCAN /.test(detail))).toEqual([]);
  h.executedSql.length = 0;
  await expect(h.api.getScorepadCatalog('abc123')).resolves.toMatchObject({ unchanged: false, version: first.version });
  expect(h.executedSql).toHaveLength(1);
});

test('the schedule rebuilds only after the catalog changed, and the version moves only with the content', async () => {
  const h = setup();
  await flushCatalogOutbox(h.gateway);
  await rebuildScorepadCatalog(h.gateway, 1000);
  const first = await h.api.getScorepadCatalog();
  // Nothing changed: two one-row reads, no writes.
  h.executedSql.length = 0;
  await expect(rebuildScorepadCatalog(h.gateway, 2000)).resolves.toBeNull();
  expect(h.executedSql).toHaveLength(2);

  // A change the catalog carries gives a new version, and the old version gets the new games.
  h.sqlite.exec(`UPDATE games SET display_name = '快照擴充（改名）' WHERE id = 'snap-expansion'`);
  await flushCatalogOutbox(h.gateway);
  await rebuildScorepadCatalog(h.gateway, 3000);
  const renamed = await h.api.getScorepadCatalog(first.version);
  if (renamed.unchanged) throw new Error('expected games');
  expect(renamed.version).not.toBe(first.version);
  expect(renamed.games.find((game) => game.gameId === 'snap-expansion')?.displayName).toBe('快照擴充（改名）');
  expect(h.count('scorepad_catalog_snapshot_chunks')).toBe(1);

  // A rule count change moves the base game's entry.
  h.sqlite.exec(`UPDATE games SET published_rule_count = 99, latest_rule_updated_at = 77 WHERE id = '${h.base.id}'`);
  await flushCatalogOutbox(h.gateway);
  await rebuildScorepadCatalog(h.gateway, 4000);
  const counted = await h.api.getScorepadCatalog(renamed.version);
  if (counted.unchanged) throw new Error('expected games');
  expect(counted.games.find((game) => game.gameId === h.base.id)).toMatchObject({ publishedRuleCount: 99, ruleVersion: '77:99' });

  // A catalog change outside what the score pad carries keeps the version; only the state row is written.
  h.sqlite.exec(`INSERT INTO game_aliases(id, game_id, alias, normalized_alias, created_at)
    VALUES('snap-no-bgg-alias', '${h.noBgg.id}', '無編號別名', 'snap-no-bgg-alias', 1)`);
  await flushCatalogOutbox(h.gateway);
  h.executedSql.length = 0;
  await expect(rebuildScorepadCatalog(h.gateway, 5000)).resolves.toEqual(expect.any(Array));
  expect(h.executedSql.filter((sql) => /^\s*(INSERT|DELETE)/.test(sql))).toEqual([]);
  expect(await h.api.getScorepadCatalog(counted.version)).toEqual({ unchanged: true, version: counted.version });
});

test('getScorepadCatalog rejects a malformed version before D1', async () => {
  const h = setup();
  h.executedSql.length = 0;
  for (const bad of ['', 'XYZ', "1' OR 1=1", 'a'.repeat(65), 42 as never]) {
    await expect(h.api.getScorepadCatalog(bad)).rejects.toThrow('version');
  }
  expect(h.executedSql).toHaveLength(0);
});
