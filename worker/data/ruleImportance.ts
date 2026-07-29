import type { Database } from './database';

export interface RuleImportanceMutation {
  important: boolean;
  count: number;
}

export const queryUserRuleImportance = async (db: Database, userId: string, gameId: string) => {
  const result = await db.statement(`
    SELECT rule_id
    FROM rule_importance_votes
    WHERE user_id = ? AND game_id = ?
    ORDER BY rule_id
  `).bind(userId, gameId).all<{ rule_id: string }>();
  return { ruleIds: (result.results ?? []).map((row) => row.rule_id) };
};

export const clearUserRuleImportance = async (db: Database, userId: string) => {
  const result = await db.statement(`
    DELETE FROM rule_importance_votes
    WHERE user_id = ?
  `).bind(userId).run();
  return { cleared: Number(result.meta?.changes ?? 0) };
};

export const setRuleImportance = async (
  db: Database,
  userId: string,
  ruleId: string,
  important: boolean,
  timestamp: number,
): Promise<RuleImportanceMutation | null> => {
  if (important) {
    await db.statement(`
      INSERT INTO rule_importance_votes (user_id, rule_id, game_id, created_at)
      SELECT ?, r.id, r.game_id, ?
      FROM rules r
      WHERE r.id = ? AND r.status = 'published'
      ON CONFLICT(user_id, rule_id) DO NOTHING
    `).bind(userId, timestamp, ruleId).run();
  } else {
    await db.statement(`
      DELETE FROM rule_importance_votes
      WHERE user_id = ? AND rule_id = ?
    `).bind(userId, ruleId).run();
  }

  const rule = await db.statement(`
    SELECT importance_count
    FROM rules
    WHERE id = ? AND status = 'published'
  `).bind(ruleId).first<{ importance_count: number }>();
  if (!rule) return null;
  return { important, count: Number(rule.importance_count ?? 0) };
};
