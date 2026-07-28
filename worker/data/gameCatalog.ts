import type { GameCatalogPayload, GameSummary } from '../../src/shared/types';
import { taipeiDateKey } from '../../src/lib/gameCatalog';
import type { Database, D1Result } from './database';

interface GameCatalogRow {
  catalog_date: string;
  generated_at: number;
  games_json: string;
}

interface GameCatalogSourceRow {
  id: string;
  slug: string;
  display_name: string;
  english_name: string | null;
  aliases_json: string | null;
  published_rule_count: number;
  total_rule_count: number;
  latest_rule_updated_at: number | null;
  updated_at: number;
}

export const queryGameCatalog = (db: Database): Promise<D1Result<GameCatalogRow>> => db.statement(`
  SELECT catalog_date, generated_at, games_json
  FROM game_search_catalog
  WHERE id = 1
`).all<GameCatalogRow>();

export const gameCatalogPayload = (row: GameCatalogRow): GameCatalogPayload => {
  const parsed = JSON.parse(row.games_json) as unknown;
  if (!Array.isArray(parsed)) throw new Error('invalid_game_catalog');
  return { catalogDate: row.catalog_date, generatedAt: row.generated_at, games: parsed as GameSummary[] };
};

export const rebuildGameCatalog = async (db: Database, timestamp = Date.now()): Promise<GameCatalogPayload> => {
  const source = await db.statement(`
    SELECT g.id, g.slug, g.display_name, g.english_name,
      COALESCE((
        SELECT json_group_array(alias)
        FROM (SELECT alias FROM game_aliases a WHERE a.game_id = g.id ORDER BY alias)
      ), '[]') AS aliases_json,
      g.published_rule_count, g.total_rule_count, g.latest_rule_updated_at, g.updated_at
    FROM games g
    WHERE g.merged_into_game_id IS NULL
    ORDER BY g.display_name
  `).all<GameCatalogSourceRow>();
  const games = (source.results ?? []).map((row): GameSummary => ({
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    englishName: row.english_name ?? undefined,
    aliases: (() => {
      try { return JSON.parse(row.aliases_json ?? '[]') as string[]; }
      catch { return []; }
    })(),
    ruleCount: Number(row.published_rule_count ?? 0),
    publishedRuleCount: Number(row.published_rule_count ?? 0),
    totalRuleCount: Number(row.total_rule_count ?? 0),
    latestRuleUpdatedAt: row.latest_rule_updated_at ?? undefined,
    updatedAt: row.updated_at,
  }));
  const payload = { catalogDate: taipeiDateKey(timestamp), generatedAt: timestamp, games };
  await db.statement(`
    INSERT INTO game_search_catalog (id, catalog_date, games_json, generated_at)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      catalog_date = excluded.catalog_date,
      games_json = excluded.games_json,
      generated_at = excluded.generated_at
  `).bind(payload.catalogDate, JSON.stringify(games), timestamp).run();
  return payload;
};
