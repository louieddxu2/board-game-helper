import type { PublicGamePreview } from '../../src/shared/gamePreview';
import type { Database } from './database';

export const queryPublicGamePreview = (db: Database, identifier: string) => db.statement(`
  SELECT g.slug, g.display_name AS displayName, g.english_name AS englishName,
    (SELECT substr(r.statement, 1, 180) FROM rules r
     WHERE r.game_id = g.id AND r.status = 'published'
     ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS statement
  FROM games g
  WHERE (g.id = ? OR g.slug = ?) AND g.visibility = 'public' AND g.merged_into_game_id IS NULL
  LIMIT 1
`).bind(identifier, identifier).first<PublicGamePreview>();
