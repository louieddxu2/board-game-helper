import type {
  AttributeComparisonResult,
  AttributeMatrixValue,
  AttributeSubject,
  AttributeSubjectComponent,
  AttributesPayload
} from '../../src/shared/types';
import { acquireAttributeReplayLock, releaseAttributeReplayLock } from './attributeLocks';
import { queryAllUnprocessedCandidates, queryAttributeDefinitions } from './attributeQueries';
import type { AttributeScoreStateRow, ComponentRow, FullReplayExternalIdRow, FullReplayGameAliasRow, FullReplayGameSourceRow, FullReplaySubjectSourceRow } from './attributeQueryShared';
import { ATTRIBUTE_QUESTION_SLOT_COUNT, ATTRIBUTE_REBUILD_STATEMENTS_PER_BATCH, ATTRIBUTE_REBUILD_STATE_ROWS_PER_STATEMENT, chunk, toComponent } from './attributeQueryShared';
import {
  ATTRIBUTE_INITIAL_RD,
  ATTRIBUTE_SCORE_MODEL_VERSION,
  applyComparison,
  emptyAttributeState,
  type OnlineAttributeState
} from './attributeScoring';
import type { Database } from './database';

interface AttributeReplayBaselineRow {
  direct_sum: number;
  direct_count: number;
}

const mergeStateKey = (subjectId: string, attributeId: string) => `${subjectId}\u0000${attributeId}`;

const stateFromBaseline = (row: AttributeReplayBaselineRow): OnlineAttributeState => {
  const directCount = Number(row.direct_count);
  const directSum = Number(row.direct_sum);
  return {
    score: directCount ? directSum / directCount : 5,
    ratingDeviation: directCount ? 1.5 / Math.sqrt(directCount) : ATTRIBUTE_INITIAL_RD,
    directSum,
    directCount,
    comparisonCount: 0,
    decisiveComparisonCount: 0,
    evidenceCount: directCount,
  };
};

const rebuildStateStatement = (
  db: Database,
  rows: Array<{ subjectId: string; attributeId: string; state: OnlineAttributeState }>,
  timestamp: number,
) => db.statement(`
  INSERT INTO attribute_score_states
    (subject_id, attribute_id, score, rating_deviation, direct_sum, direct_count,
     comparison_count, decisive_comparison_count, evidence_count, model_version,
     updated_at, random_key, question_slot)
  VALUES ${rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, lower(hex(randomblob(16))), (abs(random()) % ' + ATTRIBUTE_QUESTION_SLOT_COUNT + ') + 1)').join(', ')}
  ON CONFLICT(subject_id, attribute_id) DO UPDATE SET
    score = excluded.score,
    rating_deviation = excluded.rating_deviation,
    direct_sum = excluded.direct_sum,
    direct_count = excluded.direct_count,
    comparison_count = excluded.comparison_count,
    decisive_comparison_count = excluded.decisive_comparison_count,
    evidence_count = excluded.evidence_count,
    model_version = excluded.model_version,
    updated_at = excluded.updated_at
`).bind(...rows.flatMap(({ subjectId, attributeId, state }) => [
  subjectId, attributeId, state.score, state.ratingDeviation, state.directSum,
  state.directCount, state.comparisonCount, state.decisiveComparisonCount,
  state.evidenceCount, ATTRIBUTE_SCORE_MODEL_VERSION, timestamp,
]));

const stateMatches = (stored: AttributeScoreStateRow | undefined, next: OnlineAttributeState): boolean => {
  if (!stored || stored.model_version !== ATTRIBUTE_SCORE_MODEL_VERSION) return false;
  // Legacy materialized rows and private checkpoint payloads can contain
  // display-rounded values. That rounding must not make a no-op replay
  // rewrite every state.
  const nearlyEqual = (left: number, right: number, tolerance: number) => Math.abs(left - right) <= tolerance;
  return nearlyEqual(Number(stored.score), next.score, 0.0051)
    && nearlyEqual(Number(stored.rating_deviation), next.ratingDeviation, 0.00051)
    && nearlyEqual(Number(stored.direct_sum), next.directSum, Math.max(1e-12, Number(stored.direct_count) * 0.0051))
    && Number(stored.direct_count) === next.directCount
    && Number(stored.comparison_count) === next.comparisonCount
    && Number(stored.decisive_comparison_count) === next.decisiveComparisonCount
    && Number(stored.evidence_count) === next.evidenceCount;
};

interface StoredPairStatRow {
  subject_a_id: string;
  subject_b_id: string;
  attribute_id: string;
  comparison_count: number;
}

const pairStatKey = (subjectAId: string, subjectBId: string, attributeId: string) =>
  `${subjectAId}\u0000${subjectBId}\u0000${attributeId}`;

interface FullReplayPairSnapshotRow { active_generation: number; chunk_count: number; }

interface FullReplayPairSnapshotChunkRow { pairs_json: string; }

interface FullReplayStateSnapshotRow { active_generation: number; chunk_count: number; }

interface FullReplayStateSnapshotChunkRow { states_json: string; }

interface FullReplayHistoryRow {
  stream_id: string;
  kind: 'rating' | 'comparison';
  attribute_id: string;
  subject_a_id: string;
  subject_b_id: string | null;
  value: number | null;
  comparison: AttributeComparisonResult | null;
  created_at: number;
}

interface FullReplayResponseRow {
  response_id: string;
  attribute_id: string;
  subject_a_id: string;
  subject_b_id: string | null;
  rating_a: number | null;
  rating_b: number | null;
  comparison: AttributeComparisonResult | null;
  created_at: number;
}

export interface AttributeReplayResult {
  changed: boolean;
  catalogPayload: AttributesPayload;
  catalogThroughVersion: number;
}

const parseFullReplayJson = (value: string): unknown => {
  try { return JSON.parse(value); } catch { throw new Error('invalid_attribute_replay_snapshot'); }
};

const isChineseName = (value: string) => /[\u4E00-\u9FA5]/.test(value);

const validBggId = (value: number | string | null | undefined): number | null => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const queryFullReplaySubjects = async (db: Database): Promise<AttributeSubject[]> => {
  // Keep the outer replay's concurrent D1 work at the six-connection limit.
  const [subjectResult, gameResult, componentResult] = await Promise.all([
    db.statement(`
      SELECT id, slug, kind, display_name, game_id
      FROM attribute_subjects
      ORDER BY display_name COLLATE NOCASE, id
    `).all<FullReplaySubjectSourceRow>(),
    db.statement(`
      SELECT id, slug, display_name, english_name, bgg_id, entity_kind, merged_into_game_id, visibility
      FROM games
    `).all<FullReplayGameSourceRow>(),
    db.statement(`
      SELECT subject_id, component_order, game_id, component_type, label, english_name, bgg_id
      FROM attribute_subject_components
      ORDER BY subject_id, component_order
    `).all<ComponentRow>(),
  ]);
  const [aliasResult, externalIdResult] = await Promise.all([
    db.statement(`
      SELECT game_id, alias
      FROM game_aliases
      WHERE alias GLOB '*[一-龥]*'
      ORDER BY game_id, alias, id
    `).all<FullReplayGameAliasRow>(),
    db.statement(`
      SELECT game_id, external_id
      FROM game_external_ids
      WHERE source = 'bgg'
    `).all<FullReplayExternalIdRow>(),
  ]);

  const games = new Map((gameResult.results ?? []).map((game) => [game.id, game]));
  const componentsBySubject = new Map<string, AttributeSubjectComponent[]>();
  for (const row of componentResult.results ?? []) {
    const components = componentsBySubject.get(row.subject_id) ?? [];
    components.push(toComponent(row));
    componentsBySubject.set(row.subject_id, components);
  }

  const firstChineseAliasByGame = new Map<string, string>();
  for (const row of aliasResult.results ?? []) {
    if (!firstChineseAliasByGame.has(row.game_id)) firstChineseAliasByGame.set(row.game_id, row.alias);
  }
  const externalBggIdsByGame = new Map<string, Set<number>>();
  for (const row of externalIdResult.results ?? []) {
    const id = validBggId(row.external_id);
    if (id == null) continue;
    const ids = externalBggIdsByGame.get(row.game_id) ?? new Set<number>();
    ids.add(id);
    externalBggIdsByGame.set(row.game_id, ids);
  }

  const gameSecondaryName = (game: FullReplayGameSourceRow | undefined): string | undefined => {
    if (!game) return undefined;
    const englishName = game.english_name && game.english_name !== game.display_name
      ? game.english_name
      : undefined;
    return isChineseName(game.display_name)
      ? englishName
      : firstChineseAliasByGame.get(game.id) ?? englishName;
  };

  const subjects: AttributeSubject[] = [];
  for (const row of subjectResult.results ?? []) {
    const components = componentsBySubject.get(row.id) ?? [];
    const game = row.game_id ? games.get(row.game_id) : undefined;
    const baseComponents = components.filter((component) => component.type === 'base');
    const expansionComponents = components.filter((component) => component.type === 'expansion');
    const isVotable = row.kind === 'game'
      ? Boolean(game
        && game.entity_kind === 'base'
        && game.merged_into_game_id == null
        && game.visibility === 'public'
        && (validBggId(game.bgg_id) != null
          || (externalBggIdsByGame.get(game.id)?.size ?? 0) > 0
          || baseComponents.some((component) => component.bggId != null)))
      : baseComponents.some((component) => component.bggId != null)
        && expansionComponents.some((component) => component.bggId != null)
        && !components.some((component) =>
          (component.type === 'base' || component.type === 'expansion') && component.bggId == null);
    if (!isVotable) continue;

    const bggIds = new Set<number>();
    if (row.kind === 'game') {
      const id = validBggId(game?.bgg_id);
      if (id != null) bggIds.add(id);
    }
    for (const id of externalBggIdsByGame.get(row.game_id ?? '') ?? []) bggIds.add(id);
    for (const component of components) {
      const id = validBggId(component.bggId);
      if (id != null) bggIds.add(id);
    }

    let secondaryName = gameSecondaryName(game);
    if (row.kind === 'configuration') {
      const base = baseComponents[0];
      const baseName = gameSecondaryName(base?.gameId ? games.get(base.gameId) : undefined)
        ?? base?.englishName;
      const expansionName = expansionComponents
        .map((component) => component.englishName)
        .filter((name): name is string => Boolean(name?.trim()))
        .join(' + ') || undefined;
      secondaryName = baseName == null
        ? expansionName
        : expansionName == null ? baseName : `${baseName} + ${expansionName}`;
    }

    subjects.push({
      id: row.id,
      slug: row.slug,
      kind: row.kind,
      displayName: row.display_name,
      ...(secondaryName ? { secondaryName } : {}),
      gameId: row.game_id ?? undefined,
      gameSlug: game?.slug,
      ...(bggIds.size ? { bggIds: [...bggIds].sort((left, right) => left - right) } : {}),
      components,
    });
  }
  return subjects;
};

const queryFullReplayMetadata = async (db: Database) => {
  const clock = await db.statement('SELECT current_version FROM attribute_catalog_clock WHERE id = 1')
    .first<{ current_version: number }>();
  if (!clock) throw new Error('attribute_catalog_clock_unavailable');
  const [attributeRows, candidates] = await Promise.all([
    queryAttributeDefinitions(db),
    queryAllUnprocessedCandidates(db),
  ]);
  const subjectRows = await queryFullReplaySubjects(db);
  return {
    subjectIds: new Set(subjectRows.map((subject) => subject.id)),
    attributes: new Map(attributeRows.map((attribute) => [attribute.id, attribute])),
    subjects: new Map(subjectRows.map((subject) => [subject.id, subject])),
    candidates: new Map(candidates.map((candidate) => [candidate.id, candidate])),
    throughVersion: Number(clock.current_version),
  };
};

const queryFullReplayStateBaseline = async (db: Database) => {
  const state = await db.statement(`
    SELECT active_generation, chunk_count
    FROM attribute_replay_state_snapshot_state
    WHERE id = 1
  `).first<FullReplayStateSnapshotRow>();
  if (!state) return { states: new Map<string, AttributeScoreStateRow>(), available: false };
  const chunks = await db.statement(`
    SELECT states_json
    FROM attribute_replay_state_snapshot_chunks
    WHERE generation = ?
    ORDER BY chunk_number
  `).bind(state.active_generation).all<FullReplayStateSnapshotChunkRow>();
  if ((chunks.results ?? []).length !== Number(state.chunk_count)) throw new Error('incomplete_attribute_replay_state_baseline');
  const states = new Map<string, AttributeScoreStateRow>();
  for (const chunk of chunks.results ?? []) {
    const rows = parseFullReplayJson(chunk.states_json);
    if (!Array.isArray(rows)) throw new Error('invalid_attribute_replay_state_baseline');
    for (const row of rows) {
      if (!Array.isArray(row) || row.length !== 10
        || typeof row[0] !== 'string' || typeof row[1] !== 'string'
        || row.slice(2, 9).some((value) => typeof value !== 'number')
        || typeof row[9] !== 'string') continue;
      const [subjectId, attributeId, score, ratingDeviation, directSum, directCount,
        comparisonCount, decisiveComparisonCount, evidenceCount, modelVersion] = row as [
        string, string, number, number, number, number, number, number, number, string,
      ];
      states.set(mergeStateKey(subjectId, attributeId), {
        subject_id: subjectId,
        attribute_id: attributeId,
        score,
        rating_deviation: ratingDeviation,
        direct_sum: directSum,
        direct_count: directCount,
        comparison_count: comparisonCount,
        decisive_comparison_count: decisiveComparisonCount,
        evidence_count: evidenceCount,
        model_version: modelVersion,
      });
    }
  }
  return { states, available: true };
};

const writeFullReplayStateBaseline = async (
  db: Database,
  states: Map<string, OnlineAttributeState>,
  generation: number,
) => {
  const rows = [...states.entries()].map(([key, state]) => {
    const separator = key.indexOf('\u0000');
    return [
      key.slice(0, separator), key.slice(separator + 1), state.score,
      state.ratingDeviation, state.directSum, state.directCount,
      state.comparisonCount, state.decisiveComparisonCount, state.evidenceCount,
      ATTRIBUTE_SCORE_MODEL_VERSION,
    ];
  });
  // Keep each D1 JSON cell comfortably below the 1 MB value ceiling.
  const chunks = chunk(rows, 1000);
  if (!chunks.length) chunks.push([]);
  await db.batch([
    db.statement('DELETE FROM attribute_replay_state_snapshot_chunks WHERE generation = ?').bind(generation),
    ...chunks.map((entries, index) => db.statement(`
      INSERT INTO attribute_replay_state_snapshot_chunks (generation, chunk_number, states_json)
      VALUES (?, ?, ?)
    `).bind(generation, index, JSON.stringify(entries))),
    db.statement(`
      INSERT INTO attribute_replay_state_snapshot_state
        (id, active_generation, chunk_count, generated_at)
      VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        active_generation = excluded.active_generation,
        chunk_count = excluded.chunk_count,
        generated_at = excluded.generated_at
    `).bind(generation, chunks.length, generation),
    db.statement('DELETE FROM attribute_replay_state_snapshot_chunks WHERE generation <> ?').bind(generation),
  ]);
};

const queryFullReplayHistory = async (db: Database): Promise<FullReplayHistoryRow[]> => {
  // The canonical response table is read exactly once. Filtering active
  // attributes and expanding each response happen in Worker memory.
  const responses = await db.statement(`SELECT response_id, attribute_id, subject_a_id, subject_b_id,
    rating_a, rating_b, comparison, created_at FROM attribute_vote_responses`).all<FullReplayResponseRow>();
  const history: FullReplayHistoryRow[] = [];
  for (const row of responses.results ?? []) {
    if (row.rating_a != null) history.push({ stream_id: `response:${row.response_id}:rating-a`, kind: 'rating', attribute_id: row.attribute_id, subject_a_id: row.subject_a_id, subject_b_id: null, value: row.rating_a, comparison: null, created_at: row.created_at });
    if (row.rating_b != null && row.subject_b_id) history.push({ stream_id: `response:${row.response_id}:rating-b`, kind: 'rating', attribute_id: row.attribute_id, subject_a_id: row.subject_b_id, subject_b_id: null, value: row.rating_b, comparison: null, created_at: row.created_at });
    if (row.comparison && row.subject_b_id) history.push({ stream_id: `response:${row.response_id}:comparison`, kind: 'comparison', attribute_id: row.attribute_id, subject_a_id: row.subject_a_id, subject_b_id: row.subject_b_id, value: null, comparison: row.comparison, created_at: row.created_at });
  }
  return history.sort((left, right) => left.created_at - right.created_at || left.stream_id.localeCompare(right.stream_id));
};

const queryFullReplayPairBaseline = async (db: Database) => {
  const state = await db.statement('SELECT active_generation, chunk_count FROM attribute_replay_snapshot_state WHERE id = 1')
    .first<FullReplayPairSnapshotRow>();
  if (!state) throw new Error('attribute_replay_baseline_unavailable');
  const chunks = await db.statement('SELECT pairs_json FROM attribute_replay_snapshot_chunks WHERE generation = ? ORDER BY chunk_number')
    .bind(state.active_generation).all<FullReplayPairSnapshotChunkRow>();
  if ((chunks.results ?? []).length !== Number(state.chunk_count)) throw new Error('incomplete_attribute_replay_baseline');
  const pairs = new Map<string, StoredPairStatRow>();
  for (const chunk of chunks.results ?? []) {
    const rows = parseFullReplayJson(chunk.pairs_json);
    if (!Array.isArray(rows)) throw new Error('invalid_attribute_replay_baseline');
    for (const row of rows) {
      if (!Array.isArray(row) || row.length !== 4 || row.some((value, index) => index < 3 ? typeof value !== 'string' : typeof value !== 'number')) continue;
      const [subjectAId, subjectBId, attributeId, comparisonCount] = row as [string, string, string, number];
      pairs.set(pairStatKey(subjectAId, subjectBId, attributeId), { subject_a_id: subjectAId, subject_b_id: subjectBId, attribute_id: attributeId, comparison_count: comparisonCount });
    }
  }
  return pairs;
};

const writeFullReplayPairBaseline = async (db: Database, pairs: Array<{ subjectAId: string; subjectBId: string; attributeId: string; count: number }>, generation: number) => {
  const rows = pairs.map((pair) => [pair.subjectAId, pair.subjectBId, pair.attributeId, pair.count]);
  await db.batch([
    db.statement('DELETE FROM attribute_replay_snapshot_chunks WHERE generation = ?').bind(generation),
    db.statement('INSERT INTO attribute_replay_snapshot_chunks (generation, chunk_number, pairs_json) VALUES (?, 0, ?)').bind(generation, JSON.stringify(rows)),
    db.statement(`INSERT INTO attribute_replay_snapshot_state (id, active_generation, chunk_count, generated_at) VALUES (1, ?, 1, ?)
      ON CONFLICT(id) DO UPDATE SET active_generation = excluded.active_generation, chunk_count = excluded.chunk_count, generated_at = excluded.generated_at`).bind(generation, generation),
    db.statement('DELETE FROM attribute_replay_snapshot_chunks WHERE generation <> ?').bind(generation),
  ]);
};

/** The caller must hold the global replay lock until its snapshot is published. */
export const replayAllAttributeScoresLocked = async (db: Database, timestamp = Date.now()): Promise<AttributeReplayResult> => {
  const [metadata, history, storedPairs, stateBaseline] = await Promise.all([
    queryFullReplayMetadata(db), queryFullReplayHistory(db), queryFullReplayPairBaseline(db), queryFullReplayStateBaseline(db),
  ]);
  const { subjectIds, attributes, subjects, candidates, throughVersion } = metadata;
  const stored = stateBaseline.states;
  const states = new Map<string, OnlineAttributeState>();
  const directRatings = new Map<string, { total: number; count: number }>();
  for (const row of history) {
    if (row.kind !== 'rating' || row.value == null || !subjectIds.has(row.subject_a_id) || !attributes.has(row.attribute_id)) continue;
    const key = mergeStateKey(row.subject_a_id, row.attribute_id);
    const direct = directRatings.get(key) ?? { total: 0, count: 0 };
    direct.total += Number(row.value); direct.count += 1;
    directRatings.set(key, direct);
  }
  for (const subjectId of subjectIds) for (const attributeId of attributes.keys()) {
    const direct = directRatings.get(mergeStateKey(subjectId, attributeId));
    states.set(mergeStateKey(subjectId, attributeId), stateFromBaseline({
      direct_sum: direct?.total ?? 0, direct_count: direct?.count ?? 0,
    }));
  }
  const pairCounts = new Map<string, { subjectAId: string; subjectBId: string; attributeId: string; count: number }>();
  for (const row of history) {
    if (row.kind !== 'comparison' || !row.comparison || !row.subject_b_id || !subjectIds.has(row.subject_a_id) || !subjectIds.has(row.subject_b_id) || !attributes.has(row.attribute_id) || row.subject_a_id === row.subject_b_id) continue;
    const keyA = mergeStateKey(row.subject_a_id, row.attribute_id);
    const keyB = mergeStateKey(row.subject_b_id, row.attribute_id);
    const updated = applyComparison(states.get(keyA) ?? emptyAttributeState(), states.get(keyB) ?? emptyAttributeState(), row.comparison);
    states.set(keyA, updated.a.next); states.set(keyB, updated.b.next);
    const [subjectAId, subjectBId] = row.subject_a_id < row.subject_b_id ? [row.subject_a_id, row.subject_b_id] : [row.subject_b_id, row.subject_a_id];
    const key = pairStatKey(subjectAId, subjectBId, row.attribute_id);
    const pair = pairCounts.get(key);
    if (pair) pair.count += 1;
    else pairCounts.set(key, { subjectAId, subjectBId, attributeId: row.attribute_id, count: 1 });
  }
  const changedStates = [...states.entries()].map(([key, state]) => {
    const separator = key.indexOf('\u0000');
    return { subjectId: key.slice(0, separator), attributeId: key.slice(separator + 1), state };
  }).filter(({ subjectId, attributeId, state }) => !stateMatches(stored.get(mergeStateKey(subjectId, attributeId)), state));
  const staleStates = [...stored.values()].filter((state) => !states.has(mergeStateKey(state.subject_id, state.attribute_id)));
  const changedPairs = [...pairCounts.values()].filter((pair) => Number(storedPairs.get(pairStatKey(pair.subjectAId, pair.subjectBId, pair.attributeId))?.comparison_count) !== pair.count);
  const stalePairs = [...storedPairs.values()].filter((pair) => !pairCounts.has(pairStatKey(pair.subject_a_id, pair.subject_b_id, pair.attribute_id)));
  const changed = changedStates.length > 0 || staleStates.length > 0 || changedPairs.length > 0 || stalePairs.length > 0;
  let rebuildMode = false;
  try {
    if (changedStates.length || staleStates.length) { await db.statement('INSERT OR IGNORE INTO attribute_catalog_rebuild_mode (id) VALUES (1)').run(); rebuildMode = true; }
    for (const statementBatch of chunk(chunk(changedStates, ATTRIBUTE_REBUILD_STATE_ROWS_PER_STATEMENT).map((rows) => rebuildStateStatement(db, rows, timestamp)), ATTRIBUTE_REBUILD_STATEMENTS_PER_BATCH)) await db.batch(statementBatch);
    for (const statementBatch of chunk(staleStates.map((state) => db.statement(`
      DELETE FROM attribute_score_states
      WHERE subject_id = ? AND attribute_id = ?
    `).bind(state.subject_id, state.attribute_id)), ATTRIBUTE_REBUILD_STATEMENTS_PER_BATCH)) await db.batch(statementBatch);
    const pairStatements = changedPairs.map((pair) => db.statement(`INSERT INTO attribute_pair_stats (subject_a_id, subject_b_id, attribute_id, comparison_count, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(subject_a_id, subject_b_id, attribute_id) DO UPDATE SET comparison_count = excluded.comparison_count, updated_at = excluded.updated_at`).bind(pair.subjectAId, pair.subjectBId, pair.attributeId, pair.count, timestamp));
    for (const statementBatch of chunk(pairStatements, ATTRIBUTE_REBUILD_STATEMENTS_PER_BATCH)) await db.batch(statementBatch);
    for (const statementBatch of chunk(stalePairs.map((pair) => db.statement('DELETE FROM attribute_pair_stats WHERE subject_a_id = ? AND subject_b_id = ? AND attribute_id = ?').bind(pair.subject_a_id, pair.subject_b_id, pair.attribute_id)), ATTRIBUTE_REBUILD_STATEMENTS_PER_BATCH)) await db.batch(statementBatch);
    if (changedPairs.length || stalePairs.length) await writeFullReplayPairBaseline(db, [...pairCounts.values()], timestamp);
    if (changedStates.length || staleStates.length || !stateBaseline.available) await writeFullReplayStateBaseline(db, states, timestamp);
  } finally {
    if (rebuildMode) await db.statement('DELETE FROM attribute_catalog_rebuild_mode WHERE id = 1').run();
  }
  const values: AttributeMatrixValue[] = [...states.entries()].map(([key, state]) => {
    const separator = key.indexOf('\u0000');
    const subjectId = key.slice(0, separator);
    const attributeId = key.slice(separator + 1);
    return {
      subjectId, attributeId,
      score: Number(state.score.toFixed(2)), ratingDeviation: Number(state.ratingDeviation.toFixed(3)),
      ...(state.directCount ? { directAverage: Number((state.directSum / state.directCount).toFixed(2)) } : {}),
      directCount: state.directCount, comparisonCount: state.comparisonCount,
      decisiveComparisonCount: state.decisiveComparisonCount, evidenceCount: state.evidenceCount,
      modelVersion: ATTRIBUTE_SCORE_MODEL_VERSION,
    } as AttributeMatrixValue;
  });
  return {
    changed,
    catalogThroughVersion: throughVersion,
    catalogPayload: {
      attributes: [...attributes.values()].sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)),
      subjects: [...subjects.values()].sort((left, right) => left.displayName.localeCompare(right.displayName, 'zh-Hant') || left.id.localeCompare(right.id)),
      values, candidates: [...candidates.values()].sort((left, right) => left.sourceRowNumber - right.sourceRowNumber || left.id.localeCompare(right.id)),
      activities: [], scoreModelVersion: ATTRIBUTE_SCORE_MODEL_VERSION,
    },
  };
};

export const replayAllAttributeScores = async (db: Database, timestamp = Date.now()): Promise<AttributeReplayResult> => {
  const lock = await acquireAttributeReplayLock(db, timestamp);
  try {
    return await replayAllAttributeScoresLocked(db, timestamp);
  } finally {
    await releaseAttributeReplayLock(db, lock);
  }
};
