import type { Database, D1Result } from './database';

export const DELETED_ACCOUNT_ID = 'usr_deleted';

export interface AccountDeletionSummary {
  deletableRuleCount: number;
  retainedRuleCount: number;
  isLastAdmin: boolean;
}

interface RuleCountRow { total_count: number; deletable_count: number }

export const queryAccountDeletionSummary = async (
  db: Database,
  userId: string,
): Promise<AccountDeletionSummary> => {
  const [ruleCounts, activeAdmin, anotherAdmin] = await Promise.all([
    db.statement(`
      SELECT COUNT(*) total_count,
        COALESCE(SUM(CASE WHEN NOT EXISTS (
          SELECT 1 FROM rule_revisions rr
          WHERE rr.rule_id = r.id AND rr.edited_by <> ?
        ) THEN 1 ELSE 0 END), 0) deletable_count
      FROM rules r
      WHERE r.created_by = ?
    `).bind(userId, userId).first<RuleCountRow>(),
    db.statement(`
      SELECT 1 present FROM user_roles
      WHERE user_id = ? AND role = 'admin' AND revoked_at IS NULL
      LIMIT 1
    `).bind(userId).first<{ present: number }>(),
    db.statement(`
      SELECT 1 present FROM user_roles
      WHERE role = 'admin' AND revoked_at IS NULL AND user_id <> ?
      LIMIT 1
    `).bind(userId).first<{ present: number }>(),
  ]);

  const totalRuleCount = Number(ruleCounts?.total_count ?? 0);
  const deletableRuleCount = Number(ruleCounts?.deletable_count ?? 0);
  return {
    deletableRuleCount,
    retainedRuleCount: Math.max(0, totalRuleCount - deletableRuleCount),
    isLastAdmin: Boolean(activeAdmin && !anotherAdmin),
  };
};

const statement = (db: Database, sql: string, ...bindings: unknown[]) =>
  db.statement(sql).bind(...bindings);

/**
 * D1 batch is atomic. The delete predicate repeats the revision-author check so
 * a rule edited after the preview cannot be deleted by a stale confirmation.
 */
export const deleteAccount = async (
  db: Database,
  userId: string,
  deleteOwnUnmodifiedRules: boolean,
): Promise<{ deletedRuleCount: number }> => {
  if (userId === DELETED_ACCOUNT_ID) throw new Error('reserved_account');

  const statements = [];
  let ruleDeleteResultIndex = -1;
  if (deleteOwnUnmodifiedRules) {
    ruleDeleteResultIndex = statements.length;
    statements.push(statement(db, `
      DELETE FROM rules
      WHERE created_by = ?
        AND NOT EXISTS (
          SELECT 1 FROM rule_revisions rr
          WHERE rr.rule_id = rules.id AND rr.edited_by <> ?
        )
    `, userId, userId));
  }

  // Remove the old account id from denormalized contributor data before the
  // revision author rows are anonymized.
  statements.push(statement(db, `
    UPDATE rules
    SET editor_ids_json = COALESCE((
      SELECT json_group_array(editor_id)
      FROM (
        SELECT DISTINCT CASE WHEN value = ? THEN ? ELSE value END editor_id
        FROM json_each(COALESCE(rules.editor_ids_json, '[]'))
        ORDER BY editor_id
      )
    ), '[]')
    WHERE id IN (SELECT rule_id FROM rule_revisions WHERE edited_by = ?)
  `, userId, DELETED_ACCOUNT_ID, userId));
  statements.push(statement(db, `
    UPDATE rule_revisions
    SET previous_json = replace(previous_json, ?, ?)
    WHERE edited_by = ? OR rule_id IN (SELECT id FROM rules WHERE created_by = ?)
  `, userId, DELETED_ACCOUNT_ID, userId, userId));

  statements.push(
    statement(db, 'UPDATE games SET created_by = ? WHERE created_by = ?', DELETED_ACCOUNT_ID, userId),
    statement(db, 'UPDATE games SET rename_owner_id = ? WHERE rename_owner_id = ?', DELETED_ACCOUNT_ID, userId),
    statement(db, 'DELETE FROM submissions WHERE author_id = ? AND NOT EXISTS (SELECT 1 FROM rules WHERE submission_id = submissions.id)', userId),
    statement(db, 'UPDATE submissions SET author_id = ?, private_note = NULL, idempotency_key = NULL WHERE author_id = ?', DELETED_ACCOUNT_ID, userId),
    statement(db, 'UPDATE rules SET created_by = ? WHERE created_by = ?', DELETED_ACCOUNT_ID, userId),
    statement(db, 'UPDATE rules SET hidden_by = NULL WHERE hidden_by = ?', userId),
    statement(db, 'UPDATE rules SET reviewed_by = ?, reviewed_by_nickname = ? WHERE reviewed_by = ?', DELETED_ACCOUNT_ID, '已刪除帳號', userId),
    statement(db, 'UPDATE games SET reviewed_by = ?, reviewed_by_nickname = ? WHERE reviewed_by = ?', DELETED_ACCOUNT_ID, '已刪除帳號', userId),
    statement(db, 'UPDATE rule_revisions SET edited_by = ? WHERE edited_by = ?', DELETED_ACCOUNT_ID, userId),
    statement(db, 'UPDATE tags SET created_by = ? WHERE created_by = ?', DELETED_ACCOUNT_ID, userId),
    statement(db, 'UPDATE rule_tags SET created_by = ? WHERE created_by = ?', DELETED_ACCOUNT_ID, userId),
    statement(db, 'UPDATE user_roles SET granted_by = NULL WHERE granted_by = ?', userId),
    statement(db, 'UPDATE editor_invitations SET invited_by = ? WHERE invited_by = ?', DELETED_ACCOUNT_ID, userId),
    statement(db, 'UPDATE editor_invitations SET claimed_by = NULL WHERE claimed_by = ?', userId),
    statement(db, 'UPDATE review_batches SET created_by = ? WHERE created_by = ?', DELETED_ACCOUNT_ID, userId),
    statement(db, 'UPDATE review_proposals SET created_by = ? WHERE created_by = ?', DELETED_ACCOUNT_ID, userId),
    statement(db, 'UPDATE review_proposals SET claimed_by = NULL, claimed_until = NULL WHERE claimed_by = ?', userId),
    statement(db, 'UPDATE review_proposals SET reviewed_by = NULL WHERE reviewed_by = ?', userId),
    statement(db, 'DELETE FROM users WHERE id = ?', userId),
  );

  const results = await db.batch(statements) as D1Result[];
  return {
    deletedRuleCount: ruleDeleteResultIndex < 0
      ? 0
      : Number(results[ruleDeleteResultIndex]?.meta?.changes ?? 0),
  };
};
