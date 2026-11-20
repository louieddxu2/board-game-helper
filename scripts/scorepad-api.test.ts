// @vitest-environment node
import { expect, test } from 'vitest';
import { ScorepadApi } from '../worker';
import { flushCatalogOutbox } from '../worker/data/catalogOutbox';
import { createHarness } from './attributeReplayTestHarness';

const setup = () => {
  const h = createHarness();
  const games = h.sqlite.prepare(`SELECT id, bgg_id FROM games WHERE visibility = 'public' AND merged_into_game_id IS NULL
    AND review_status <> 'pending' AND bgg_id IS NOT NULL ORDER BY id LIMIT 5`).all() as { id: string; bgg_id: number }[];
  const [listed, edition, hidden, pending, merged] = games;
  h.sqlite.exec(`
    INSERT INTO game_external_ids(id, game_id, source, external_id, relation, created_at)
      VALUES('scorepad-edition', '${edition.id}', 'bgg', '990001', 'edition', 1);
    INSERT INTO game_aliases(id, game_id, alias, normalized_alias, created_at)
      VALUES('scorepad-alias', '${listed.id}', '計分板別名', 'scorepad-alias', 1),
        ('scorepad-hidden-alias', '${hidden.id}', '隱藏別名', 'scorepad-hidden-alias', 1);
    UPDATE games SET visibility = 'hidden' WHERE id = '${hidden.id}';
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

test('lookupGamesByBgg finds both BGG id sources and returns only listed games', async () => {
  const h = setup();
  h.executedSql.length = 0;
  const found = await h.api.lookupGamesByBgg([String(h.listed.bgg_id), '990001', String(h.hidden.bgg_id),
    String(h.pending.bgg_id), String(h.merged.bgg_id), '999999999', String(h.listed.bgg_id)]);
  expect(found.map((game) => [game.bggId, game.gameId])).toEqual([
    [String(h.listed.bgg_id), h.listed.id], ['990001', h.edition.id],
  ].sort((a, b) => a[0].localeCompare(b[0])));
  const listed = found.find((game) => game.gameId === h.listed.id)!;
  expect(listed.aliases).toContain('計分板別名');
  expect(Object.keys(listed).sort()).toEqual(['aliases', 'bggId', 'displayName', 'englishName', 'gameId']);
  expect(typeof listed.displayName).toBe('string');
  expect(JSON.stringify(found)).not.toContain('隱藏別名');
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

test('listGameChangesSince pages the catalog and reports unlisted games as deleted', async () => {
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
  for (const game of [h.hidden, h.pending, h.merged]) {
    expect(byId.get(game.id)).toEqual({ gameId: game.id, catalogVersion: expect.any(Number), deleted: true, bggIds: [String(game.bgg_id)] });
  }
  expect(byId.get(h.listed.id)).toEqual(expect.objectContaining({ deleted: false, bggIds: [String(h.listed.bgg_id)], aliases: expect.arrayContaining(['計分板別名']) }));
  expect(byId.get(h.edition.id)?.bggIds).toEqual([String(h.edition.bgg_id), '990001'].sort());

  h.sqlite.exec(`UPDATE games SET review_status = 'reviewed' WHERE id = '${h.pending.id}';`);
  await flushCatalogOutbox(h.gateway);
  const approved = await h.api.listGameChangesSince(after, 200);
  expect(approved.changes).toEqual([expect.objectContaining({ gameId: h.pending.id, deleted: false })]);
  expect(approved.hasMore).toBe(false);
  expect(await h.api.listGameChangesSince(approved.throughVersion, 1)).toEqual({ changes: [], throughVersion: approved.throughVersion, hasMore: false });
});

test('BGG id and review changes advance the game catalog', async () => {
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
