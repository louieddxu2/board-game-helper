import type { HomeRecentGame } from '../../src/shared/types';
import type { Database, D1Result } from './database';

export const HOME_RECENT_GAMES = 6;
/** The newest rules walked to find six games; a burst on one game cannot cost more than this. */
export const HOME_RECENT_SCAN = 60;
const DAY_MS = 86_400_000;
/** Days are counted in Taiwan time, where the site's contributors add rules. */
const TAIWAN_OFFSET_MS = 8 * 3_600_000;

const taiwanDayStart = (timestamp: number) =>
  Math.floor((timestamp + TAIWAN_OFFSET_MS) / DAY_MS) * DAY_MS - TAIWAN_OFFSET_MS;

const taiwanDate = (dayStart: number) => new Date(dayStart + TAIWAN_OFFSET_MS).toISOString().slice(0, 10);

/**
 * One entry per game, newest first: the game's newest published rule and how many of its rules
 * were published on that rule's Taiwan day. A game's count reads only that day's index rows.
 */
export const queryHomeRecentGames = async (
  db: Database,
  track: <T extends D1Result<unknown>>(name: string, res: T) => T,
): Promise<HomeRecentGame[]> => {
  const newest = track('home:recent-rules', await db.statement(`
    SELECT r.id, r.game_id, r.created_at FROM rules r INDEXED BY idx_rules_recent
    CROSS JOIN games g ON g.id = r.game_id
    WHERE r.status = 'published' AND g.visibility = 'public' AND g.merged_into_game_id IS NULL
    ORDER BY r.created_at DESC LIMIT ${HOME_RECENT_SCAN}
  `).all<{ id: string; game_id: string; created_at: number }>());
  const picked = new Map<string, { ruleId: string; dayStart: number }>();
  for (const row of newest.results ?? []) {
    if (picked.size >= HOME_RECENT_GAMES) break;
    if (!picked.has(row.game_id)) picked.set(row.game_id, { ruleId: row.id, dayStart: taiwanDayStart(Number(row.created_at)) });
  }
  if (picked.size === 0) return [];
  const entries = [...picked];
  const counts = await db.batch(entries.map(([gameId, { dayStart }]) => db.statement(`
    SELECT COUNT(*) AS n FROM rules INDEXED BY idx_rules_game_status
    WHERE game_id = ? AND status = 'published' AND created_at >= ?
  `).bind(gameId, dayStart)));
  return entries.map(([, { ruleId, dayStart }], index) => {
    const result = track(`home:recent-count-${index}`, counts[index]) as D1Result<{ n: number }>;
    return { ruleId, addedOn: taiwanDate(dayStart), addedCount: Math.max(1, Number(result.results?.[0]?.n ?? 1)) };
  });
};
