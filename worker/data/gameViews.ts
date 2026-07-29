import type { Database } from './database';
import { sha256Hex } from '../utils';

export const GAME_VIEW_COOKIE = 'wbr_view_day';
const DAY_MS = 24 * 60 * 60 * 1000;

export const utcDate = (timestamp: number): string => new Date(timestamp).toISOString().slice(0, 10);

export const dailyViewToken = (cookieValue: string | undefined, timestamp: number): { token: string; created: boolean } => {
  const date = utcDate(timestamp);
  if (cookieValue?.startsWith(`${date}.`) && /^[0-9a-f-]{36}$/i.test(cookieValue.slice(date.length + 1))) {
    return { token: cookieValue, created: false };
  }
  return { token: `${date}.${crypto.randomUUID()}`, created: true };
};

export const secondsUntilNextUtcDay = (timestamp: number): number => {
  const current = new Date(timestamp);
  const nextUtcDay = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate() + 1);
  return Math.max(1, Math.ceil((nextUtcDay - timestamp) / 1000));
};

export const anonymousGameViewKey = (token: string, gameId: string, viewDate: string): Promise<string> =>
  sha256Hex(`game-view-v1\0${token}\0${gameId}\0${viewDate}`);

export const recordAnonymousGameView = async (
  db: Database,
  gameId: string,
  viewDate: string,
  viewKey: string,
  timestamp: number,
): Promise<boolean> => {
  const inserted = await db.statement(`
    INSERT INTO game_view_dedup (game_id, view_date, view_key, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(game_id, view_date, view_key) DO NOTHING
  `).bind(gameId, viewDate, viewKey, timestamp).run();
  return Number(inserted.meta?.changes ?? 0) > 0;
};

export const cleanupGameViewData = async (db: Database, timestamp: number): Promise<void> => {
  const dedupCutoff = timestamp - DAY_MS;
  const aggregateCutoff = utcDate(timestamp - 13 * DAY_MS);
  await db.batch([
    db.statement('DELETE FROM game_view_dedup WHERE created_at < ?').bind(dedupCutoff),
    db.statement('DELETE FROM game_daily_view_counts WHERE view_date < ?').bind(aggregateCutoff),
  ]);
};

export const isWeeklyCatalogRun = (timestamp: number): boolean => new Date(timestamp).getUTCDay() === 0;
