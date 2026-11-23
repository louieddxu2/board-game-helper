// @vitest-environment node
import { expect, test } from 'vitest';
import { ScorepadApi } from '../worker';
import { flushCatalogOutbox } from '../worker/data/catalogOutbox';
import { queryScorepadCatalogGames, rebuildScorepadCatalog } from '../worker/data/scorepadSnapshot';
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
  const games = async (knownVersion?: string) => {
    const result = await api.getScorepadCatalog(knownVersion);
    if (result.unchanged) throw new Error('expected games');
    return { ...result, byId: new Map(result.games.map((game) => [game.gameId, game])) };
  };
  return { ...h, api, plan, count, games, base, merged, noBgg };
};

const baseTableScans = (plan: string[]) => plan.filter((detail) => /^SCAN /.test(detail)
  && !/^SCAN (candidates|requested|json_each|CONSTANT ROW|\(subquery)/.test(detail));

test('getScorepadCatalog returns every unmerged game with a BGG id, hidden ones included, with RuleRef', async () => {
  const h = setup();
  await flushCatalogOutbox(h.gateway);
  const { version, games, byId } = await h.games();
  expect(version).toBe('1');
  expect(byId.size).toBe(games.length);
  expect(games.map((game) => game.gameId)).toEqual([...byId.keys()].sort());
  expect(games.every((game) => game.bggIds.length > 0)).toBe(true);
  expect(byId.has(h.merged.id)).toBe(false);
  expect(byId.has(h.noBgg.id)).toBe(false);
  const row = h.sqlite.prepare('SELECT published_rule_count FROM games WHERE id = ?').get(h.base.id) as { published_rule_count: number | null };
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
  expect(h.count('scorepad_catalog_entries')).toBe(games.length);
});

test('a current version costs one state-row read, and every query reaches its tables through an index', async () => {
  const h = setup();
  h.executedSql.length = 0;
  await rebuildScorepadCatalog(h.gateway, 1000);
  expect(baseTableScans(h.plan(h.executedSql.find((sql) => sql.includes('WITH candidates'))!))).toEqual([]);
  h.executedSql.length = 0;
  const { version } = await h.games();
  expect(h.executedSql).toHaveLength(2);
  expect(h.executedSql.flatMap((sql) => h.plan(sql)).filter((detail) => /^SCAN /.test(detail))).toEqual([]);
  h.executedSql.length = 0;
  expect(await h.api.getScorepadCatalog(version)).toEqual({ unchanged: true, version });
  expect(h.executedSql).toHaveLength(1);

  // A flush touching one base game reads that game and the expansions that lead to it.
  h.sqlite.exec(`UPDATE games SET published_rule_count = 99, latest_rule_updated_at = 77 WHERE id = '${h.base.id}'`);
  h.executedSql.length = 0;
  await flushCatalogOutbox(h.gateway);
  const targeted = h.executedSql.find((sql) => sql.includes('WITH requested'))!;
  expect(baseTableScans(h.plan(targeted))).toEqual([]);
  h.executedSql.length = 0;
  await rebuildScorepadCatalog(h.gateway, 2000);
  expect(h.executedSql.filter((sql) => /FROM scorepad_catalog_entries/.test(sql)).flatMap((sql) => h.plan(sql))
    .filter((detail) => /^SCAN /.test(detail) && !/USING INDEX/.test(detail))).toEqual([]);
});

test('a flush updates only the entries whose content changed, and a call merges them over the snapshot', async () => {
  const h = setup();
  await rebuildScorepadCatalog(h.gateway, 1000);
  const first = await h.games();

  // A rule count change moves the base game's entry only.
  h.sqlite.exec(`UPDATE games SET published_rule_count = 99, latest_rule_updated_at = 77 WHERE id = '${h.base.id}'`);
  await flushCatalogOutbox(h.gateway);
  const counted = await h.games(first.version);
  expect(counted.version).toBe('2');
  expect(counted.byId.get(h.base.id)).toMatchObject({ publishedRuleCount: 99, ruleVersion: '77:99' });

  // Hiding the base game moves its expansion's rule reference too.
  h.sqlite.exec(`UPDATE games SET visibility = 'hidden' WHERE id = '${h.base.id}'`);
  await flushCatalogOutbox(h.gateway);
  const hidden = await h.games(counted.version);
  expect(hidden.byId.get('snap-expansion')).toMatchObject({ ruleGameId: null });
  expect(hidden.byId.get(h.base.id)).toMatchObject({ ruleGameId: null });

  // A game that loses its BGG ids leaves the catalog; one that is merged away does too.
  h.sqlite.exec(`DELETE FROM game_external_ids WHERE id = 'snap-external';
    UPDATE games SET merged_into_game_id = '${h.base.id}' WHERE id = 'snap-expansion';`);
  await flushCatalogOutbox(h.gateway);
  const removed = await h.games(hidden.version);
  expect(removed.byId.has('snap-edition-only')).toBe(false);
  expect(removed.byId.has('snap-expansion')).toBe(false);
  // The entries equal a fresh read of the source tables.
  expect(removed.games).toEqual(await queryScorepadCatalogGames(h.gateway));

  // A catalog change the score pad does not carry keeps the version and writes no entry.
  const before = h.count('scorepad_catalog_entries');
  h.sqlite.exec(`INSERT INTO game_aliases(id, game_id, alias, normalized_alias, created_at)
    VALUES('snap-no-bgg-alias', '${h.noBgg.id}', '無編號別名', 'snap-no-bgg-alias', 1)`);
  await flushCatalogOutbox(h.gateway);
  expect(await h.api.getScorepadCatalog(removed.version)).toEqual({ unchanged: true, version: removed.version });
  expect(h.count('scorepad_catalog_entries')).toBe(before);

  // The weekly snapshot folds the entries in, drops the removals, and serves the same games.
  await expect(rebuildScorepadCatalog(h.gateway, 3000)).resolves.toBe(true);
  expect(h.count('scorepad_catalog_entries WHERE deleted = 1')).toBe(0);
  expect((await h.games()).games).toEqual(removed.games);
  await expect(rebuildScorepadCatalog(h.gateway, 4000)).resolves.toBe(false);
});

test('getScorepadCatalog rejects a malformed version before D1', async () => {
  const h = setup();
  h.executedSql.length = 0;
  for (const bad of ['', 'abc', "1' OR 1=1", '1'.repeat(17), 42 as never]) {
    await expect(h.api.getScorepadCatalog(bad)).rejects.toThrow('version');
  }
  expect(h.executedSql).toHaveLength(0);
});
