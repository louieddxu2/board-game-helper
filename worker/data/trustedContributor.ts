import type { Database, DatabaseStatement } from './database';

/**
 * Once a contributor becomes an editor or admin, their own rules and games are trusted like
 * anything an editor creates: they no longer show a review line, including rules reviewed
 * before the grant. A rule waiting on someone else's edit keeps waiting for review.
 */
export const trustContributorStatements = (db: Database, userId: string): DatabaseStatement[] => [
  db.statement(`
    UPDATE rules
    SET review_status = 'not_required', pending_review_by = NULL,
      reviewed_by = NULL, reviewed_by_nickname = NULL, reviewed_at = NULL
    WHERE created_by = ?
      AND (review_status = 'reviewed'
        OR (review_status = 'pending' AND (pending_review_by IS NULL OR pending_review_by = ?)))
  `).bind(userId, userId),
  db.statement(`
    UPDATE games
    SET review_status = 'not_required', reviewed_by = NULL, reviewed_by_nickname = NULL, reviewed_at = NULL
    WHERE created_by = ? AND review_status IN ('pending', 'reviewed')
  `).bind(userId),
];
