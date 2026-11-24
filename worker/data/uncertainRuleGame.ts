import type { SessionUser } from '../../src/shared/types';
import { initialReviewStatus } from '../contributions';
import { cleanAliases, cleanOptional, createId, normalizeText, slugify } from '../utils';
import type { Database, DatabaseStatement } from './database';
import { resolveRuleBaseGame } from './gameEntities';
import { findGameByRequestedName } from './gameNameMatch';

export interface UncertainRuleGame {
  game: { id: string; slug: string };
  /** Run in the same batch as the uncertain rule, so a new game never exists without it. */
  statements: DatabaseStatement[];
  created: boolean;
}

/**
 * The game an uncertain rule names. An existing name (or its expansion's base game) is reused;
 * otherwise an ordinary public game is created the way a rule submission creates one. With no
 * published rule it stays out of the site's search and lists, and without a BGG id it stays out
 * of the score pad catalog; a later rule submission finds it by name instead of duplicating it.
 */
export const findOrCreateGameByName = async (
  db: Database,
  requested: { displayName: string; englishName?: string },
  user: Pick<SessionUser, 'id' | 'roles'>,
  timestamp: number,
): Promise<UncertainRuleGame> => {
  const existing = await findGameByRequestedName(db, [requested.displayName, requested.englishName]);
  const base = existing && await resolveRuleBaseGame(db, existing.id);
  if (base) return { game: { id: base.id, slug: base.slug }, statements: [], created: false };
  const gameId = createId('game');
  const englishName = cleanOptional(requested.englishName, 120);
  const baseSlug = slugify(englishName || requested.displayName);
  const slugTaken = await db.statement('SELECT 1 found FROM games WHERE slug = ?').bind(baseSlug).first();
  const slug = slugTaken ? `${baseSlug}-${gameId.slice(-6)}` : baseSlug;
  const statements = [db.statement(`
    INSERT INTO games (
      id, slug, display_name, english_name, normalized_name, created_by, rename_owner_id,
      created_at, updated_at, visibility, review_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'public', ?)
  `).bind(gameId, slug, requested.displayName, englishName ?? null, normalizeText(requested.displayName),
    user.id, user.id, timestamp, timestamp, initialReviewStatus(user))];
  for (const alias of cleanAliases([], requested.displayName, englishName)) {
    statements.push(db.statement(`
      INSERT INTO game_aliases (id, game_id, alias, normalized_alias, alias_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(createId('alias'), gameId, alias, normalizeText(alias), alias === requested.displayName ? 'official' : 'alias', timestamp));
  }
  return { game: { id: gameId, slug }, statements, created: true };
};
