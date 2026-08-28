import type { GameEntityKind } from '../../src/shared/gameEntity';
import { classifyGameEntityLabel, normalizeGameEntityLabel } from '../../src/shared/gameEntity';
import type { Database, DatabaseStatement } from './database';

interface ExistingVariantRow {
  game_id: string;
  normalized_name: string;
  entity_kind: Exclude<GameEntityKind, 'base'>;
}

const stableVariantSuffix = (parentGameId: string, kind: GameEntityKind, normalizedName: string): string => {
  const input = `${parentGameId}:${kind}:${normalizedName}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};
const variantRelationType = (kind: GameEntityKind): 'expansion_of' | 'version_of' => (
  kind === 'expansion' ? 'expansion_of' : 'version_of'
);

/**
 * Convert recognized legacy labels into entity rows during normal rule writes.
 * Unknown labels intentionally stay in the legacy text field for later review.
 * IDs are deterministic so concurrent submissions converge on one entity.
 */
export const ensureRuleGameVariantStatements = async (
  db: Database,
  parentGameId: string,
  ruleId: string,
  labels: string[],
  timestamp: number,
): Promise<DatabaseStatement[]> => {
  const normalizedLabels = Array.from(new Map(
    labels
      .map((label) => ({ label: label.trim(), normalizedName: normalizeGameEntityLabel(label), kind: classifyGameEntityLabel(label) }))
      .filter(({ normalizedName, kind }) => Boolean(normalizedName) && (kind === 'expansion' || kind === 'version'))
      .map((value) => [`${value.kind}:${value.normalizedName}`, value] as const),
  ).values());
  if (!normalizedLabels.length) return [];

  const existing = await db.statement(`
    SELECT relation.source_game_id AS game_id, game.normalized_name, game.entity_kind
    FROM game_entity_relations relation
    JOIN games game ON game.id = relation.source_game_id
    WHERE relation.target_game_id = ?
      AND relation.relation_type IN ('expansion_of', 'version_of')
    LIMIT 200
  `).bind(parentGameId).all<ExistingVariantRow>();
  const existingByKey = new Map(
    (existing.results ?? []).map((row) => [`${row.entity_kind}:${row.normalized_name}`, row.game_id]),
  );
  const statements: DatabaseStatement[] = [];
  const linkedGameIds = new Set<string>();

  for (const item of normalizedLabels) {
    const key = `${item.kind}:${item.normalizedName}`;
    const suffix = stableVariantSuffix(parentGameId, item.kind, item.normalizedName);
    const gameId = existingByKey.get(key) ?? `game_variant_${suffix}`;
    if (!existingByKey.has(key)) {
      statements.push(db.statement(`
        INSERT OR IGNORE INTO games (
          id, slug, display_name, english_name, normalized_name, merged_into_game_id,
          created_by, created_at, updated_at, visibility, review_status, attribute_enabled,
          entity_kind
        ) VALUES (?, ?, ?, NULL, ?, NULL, NULL, ?, ?, 'hidden', 'pending', 0, ?)
      `).bind(
        gameId,
        `variant-${suffix}`,
        item.label,
        item.normalizedName,
        timestamp,
        timestamp,
        item.kind,
      ));
      statements.push(db.statement(`
        INSERT OR IGNORE INTO game_entity_relations (
          id, source_game_id, target_game_id, relation_type, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `).bind(
        `game_relation_${suffix}`,
        gameId,
        parentGameId,
        variantRelationType(item.kind),
        timestamp,
      ));
    }
    if (linkedGameIds.has(gameId)) continue;
    linkedGameIds.add(gameId);
    statements.push(db.statement(`
      INSERT OR IGNORE INTO rule_game_variants (rule_id, game_id, created_at)
      VALUES (?, ?, ?)
    `).bind(ruleId, gameId, timestamp));
  }
  return statements;
};
