// @vitest-environment node
import { expect, test } from 'vitest';
import { ScorepadApi } from '../worker';
import { flushCatalogOutbox } from '../worker/data/catalogOutbox';
import { createHarness } from './attributeReplayTestHarness';

const setup = () => {
  const h = createHarness();
  const games = h.sqlite.prepare(`SELECT id, bgg_id FROM games WHERE visibility = 'public' AND merged_into_game_id IS NULL
    AND bgg_id IS NOT NULL ORDER BY id LIMIT 5`).all() as { id: string; bgg_id: number }[];
  const [listed, edition, hidden, pending, merged] = games;
  h.sqlite.exec(`
    INSERT INTO game_external_ids(id, game_id, source, external_id, relation, created_at)
      VALUES('scorepad-edition', '${edition.id}', 'bgg', '990001', 'edition', 1);
    INSERT INTO game_aliases(id, game_id, alias, normalized_alias, created_at)
      VALUES('scorepad-alias', '${listed.id}', '計分板別名', 'scorepad-alias', 1),
        ('scorepad-hidden-alias', '${hidden.id}', '隱藏別名', 'scorepad-hidden-alias', 1);
    UPDATE games SET visibility = 'hidden' WHERE id = '${hidden.id}';
    -- Imported games await editor confirmation but stay listed on the public site.
    UPDATE games SET review_status = 'pending' WHERE id = '${pending.id}';
    UPDATE games SET merged_into_game_id = '${listed.id}' WHERE id = '${merged.id}';`);
  const api = new ScorepadApi({}, h.env as never);
  const plan = (sql: string): string[] => h.sqlite.prepare('EXPLAIN QUERY PLAN ' + sql).all()
    .map((row: { detail: unknown }) => String(row.detail));
  return { ...h, api, plan, listed, edition, hidden, pending, merged };
};

// The id list or the change page drives each lookup; no base table is scanned.
const baseTableScans = (plan: string[]) => plan.filter((detail) => /^SCAN /.test(detail)
  && !/^SCAN (requested|page|matched|json_each|CONSTANT ROW|\(subquery)/.test(detail));

test('lookupGamesByBgg finds both BGG id sources and returns unmerged games, hidden ones included', async () => {
  const h = setup();
  h.executedSql.length = 0;
  const found = await h.api.lookupGamesByBgg([String(h.listed.bgg_id), '990001', String(h.hidden.bgg_id),
    String(h.pending.bgg_id), String(h.merged.bgg_id), '999999999', String(h.listed.bgg_id)]);
  expect(found.map((game) => [game.bggId, game.gameId])).toEqual([
    [String(h.listed.bgg_id), h.listed.id], ['990001', h.edition.id], [String(h.hidden.bgg_id), h.hidden.id],
    [String(h.pending.bgg_id), h.pending.id],
  ].sort((a, b) => a[0].localeCompare(b[0])));
  const listed = found.find((game) => game.gameId === h.listed.id)!;
  expect(listed.aliases).toContain('計分板別名');
  expect(Object.keys(listed).sort()).toEqual(['aliases', 'bggId', 'displayName', 'englishName', 'gameId', 'publishedRuleCount', 'ruleGameId', 'ruleVersion']);
  expect(typeof listed.displayName).toBe('string');
  // The site hides expansions and versions while their names await review; with a BGG id a score pad can still play them.
  expect(found.find((game) => game.gameId === h.hidden.id)?.aliases).toEqual(['隱藏別名']);
  expect(found.map((game) => game.gameId)).not.toContain(h.merged.id);
  expect(h.executedSql).toHaveLength(1);
  expect(baseTableScans(h.plan(h.executedSql[0]))).toEqual([]);
});

test('lookupGamesByBgg rejects oversize and malformed id lists before reading D1', async () => {
  const h = setup();
  h.executedSql.length = 0;
  await expect(h.api.lookupGamesByBgg(Array.from({ length: 101 }, (_, i) => String(i + 1)))).rejects.toThrow('limit_100');
  await expect(h.api.lookupGamesByBgg(['12', 'abc'])).rejects.toThrow('positive_integer');
  await expect(h.api.lookupGamesByBgg('12' as never)).rejects.toThrow('array');
  expect(h.executedSql).toHaveLength(0);
  await expect(h.api.lookupGamesByBgg(Array.from({ length: 100 }, (_, i) => String(i + 1)))).resolves.toEqual(expect.any(Array));
  await expect(h.api.lookupGamesByBgg([])).resolves.toEqual([]);
});

test('listGameChangesSince pages the catalog and reports merged games and hidden games without a BGG id as deleted', async () => {
  const h = setup();
  await flushCatalogOutbox(h.gateway);
  const version = await h.api.currentGameCatalogVersion();
  const all = [];
  let after = 0;
  for (let page = 0; page < 20; page++) {
    h.executedSql.length = 0;
    const result = await h.api.listGameChangesSince(after, 37);
    expect(h.executedSql).toHaveLength(1);
    expect(baseTableScans(h.plan(h.executedSql[0]))).toEqual([]);
    expect(result.changes.length).toBeLessThanOrEqual(37);
    all.push(...result.changes);
    after = result.throughVersion;
    if (!result.hasMore) break;
  }
  expect(after).toBe(version);
  const byId = new Map(all.map((change) => [change.gameId, change]));
  expect(byId.size).toBe(all.length);
  expect(byId.get(h.merged.id)).toEqual({ gameId: h.merged.id, catalogVersion: expect.any(Number), deleted: true, bggIds: [String(h.merged.bgg_id)] });
  expect(byId.get(h.hidden.id)).toEqual(expect.objectContaining({ deleted: false, bggIds: [String(h.hidden.bgg_id)], aliases: ['隱藏別名'] }));
  expect(byId.get(h.listed.id)).toEqual(expect.objectContaining({ deleted: false, bggIds: [String(h.listed.bgg_id)], aliases: expect.arrayContaining(['計分板別名']) }));
  expect(byId.get(h.edition.id)?.bggIds).toEqual([String(h.edition.bgg_id), '990001'].sort());
  expect(byId.get(h.pending.id)).toEqual(expect.objectContaining({ deleted: false, bggIds: [String(h.pending.bgg_id)] }));

  // A hidden game that loses its BGG id leaves the score pad's catalog; made public, it returns.
  h.sqlite.exec(`UPDATE games SET bgg_id = NULL WHERE id = '${h.hidden.id}';
    DELETE FROM game_external_ids WHERE game_id = '${h.hidden.id}' AND source = 'bgg';`);
  await flushCatalogOutbox(h.gateway);
  const dropped = await h.api.listGameChangesSince(after, 200);
  expect(dropped.changes).toEqual([{ gameId: h.hidden.id, catalogVersion: expect.any(Number), deleted: true, bggIds: [] }]);
  after = dropped.throughVersion;
  h.sqlite.exec(`UPDATE games SET visibility = 'public' WHERE id = '${h.hidden.id}';`);
  await flushCatalogOutbox(h.gateway);
  const shown = await h.api.listGameChangesSince(after, 200);
  expect(shown.changes).toEqual([expect.objectContaining({ gameId: h.hidden.id, deleted: false, aliases: ['隱藏別名'] })]);
  expect(shown.hasMore).toBe(false);
  expect(await h.api.listGameChangesSince(shown.throughVersion, 1)).toEqual({ changes: [], throughVersion: shown.throughVersion, hasMore: false });
});

test('BGG id changes in either source advance the game catalog', async () => {
  const h = setup();
  await flushCatalogOutbox(h.gateway);
  const before = await h.api.currentGameCatalogVersion();
  h.sqlite.exec(`INSERT INTO game_external_ids(id, game_id, source, external_id, relation, created_at)
    VALUES('scorepad-new-edition', '${h.listed.id}', 'bgg', '990002', 'edition', 2);`);
  await flushCatalogOutbox(h.gateway);
  const added = await h.api.listGameChangesSince(before, 200);
  expect(added.changes).toEqual([expect.objectContaining({ gameId: h.listed.id, bggIds: [String(h.listed.bgg_id), '990002'].sort() })]);
  h.sqlite.exec(`DELETE FROM game_external_ids WHERE id = 'scorepad-new-edition';`);
  await flushCatalogOutbox(h.gateway);
  const removed = await h.api.listGameChangesSince(added.throughVersion, 200);
  expect(removed.changes).toEqual([expect.objectContaining({ gameId: h.listed.id, bggIds: [String(h.listed.bgg_id)] })]);
  h.sqlite.exec(`UPDATE games SET bgg_id = 990003 WHERE id = '${h.listed.id}';`);
  await flushCatalogOutbox(h.gateway);
  const renumbered = await h.api.listGameChangesSince(removed.throughVersion, 200);
  expect(renumbered.changes).toEqual([expect.objectContaining({ gameId: h.listed.id, bggIds: [String(h.listed.bgg_id), '990003'].sort() })]);
});

test('listGameChangesSince validates its cursor and page size', async () => {
  const h = setup();
  h.executedSql.length = 0;
  await expect(h.api.listGameChangesSince(0, 201)).rejects.toThrow('limit');
  await expect(h.api.listGameChangesSince(0, 0)).rejects.toThrow('limit');
  await expect(h.api.listGameChangesSince(-1, 10)).rejects.toThrow('after_version');
  await expect(h.api.listGameChangesSince(1.5, 10)).rejects.toThrow('after_version');
  expect(h.executedSql).toHaveLength(0);
});

test('catalog entries say where each game\'s rules live, with the count and version only on the base game', async () => {
  const h = setup();
  h.sqlite.exec(`INSERT INTO games(id, slug, display_name, normalized_name, created_at, updated_at, visibility, review_status, entity_kind, bgg_id)
      VALUES('scorepad-expansion', 'scorepad-expansion', '計分擴充', '計分擴充', 1, 1, 'hidden', 'pending', 'expansion', 990010);
    INSERT INTO game_entity_relations(id, source_game_id, target_game_id, relation_type, created_at)
      VALUES('scorepad-relation', 'scorepad-expansion', '${h.listed.id}', 'expansion_of', 1);`);
  const row = h.sqlite.prepare('SELECT published_rule_count, latest_rule_updated_at FROM games WHERE id = ?').get(h.listed.id) as {
    published_rule_count: number | null; latest_rule_updated_at: number | null };
  const baseRef = {
    ruleGameId: h.listed.id,
    publishedRuleCount: Number(row.published_rule_count ?? 0),
    ruleVersion: `${Number(row.latest_rule_updated_at ?? 0)}:${Number(row.published_rule_count ?? 0)}`,
  };
  h.executedSql.length = 0;
  const found = await h.api.lookupGamesByBgg([String(h.listed.bgg_id), '990010', String(h.hidden.bgg_id)]);
  expect(h.executedSql).toHaveLength(1);
  expect(baseTableScans(h.plan(h.executedSql[0]))).toEqual([]);
  const byId = new Map(found.map((game) => [game.gameId, game]));
  expect(byId.get(h.listed.id)).toMatchObject(baseRef);
  expect(baseRef.ruleVersion).toBe((await h.api.getRuleSummaryByBgg(String(h.listed.bgg_id)))?.ruleVersion);
  // The expansion points at its base game; its count is read from the base game's entry.
  expect(byId.get('scorepad-expansion')).toEqual(expect.objectContaining({ ruleGameId: h.listed.id }));
  expect(byId.get('scorepad-expansion')).not.toHaveProperty('publishedRuleCount');
  // A hidden base game has no rules on the site.
  expect(byId.get(h.hidden.id)).toEqual(expect.objectContaining({ ruleGameId: null }));

  await flushCatalogOutbox(h.gateway);
  const before = await h.api.currentGameCatalogVersion();
  // A rule count change moves the base game's entry, so a synced count stays current.
  h.sqlite.exec(`UPDATE games SET published_rule_count = ${baseRef.publishedRuleCount + 1}, latest_rule_updated_at = 77 WHERE id = '${h.listed.id}';`);
  await flushCatalogOutbox(h.gateway);
  const changed = await h.api.listGameChangesSince(before, 200);
  expect(changed.changes).toEqual([expect.objectContaining({
    gameId: h.listed.id, ruleGameId: h.listed.id, publishedRuleCount: baseRef.publishedRuleCount + 1,
    ruleVersion: `77:${baseRef.publishedRuleCount + 1}`,
  })]);
  // Removing the relation moves the expansion's entry; it no longer leads to rules.
  h.sqlite.exec(`DELETE FROM game_entity_relations WHERE id = 'scorepad-relation';`);
  await flushCatalogOutbox(h.gateway);
  const unlinked = await h.api.listGameChangesSince(changed.throughVersion, 200);
  expect(unlinked.changes).toEqual([expect.objectContaining({ gameId: 'scorepad-expansion', deleted: false, ruleGameId: null })]);
});
