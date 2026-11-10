import type {
  AttributeMatrixValue,
  AttributeSubject,
  AttributeSubjectComponent,
  AttributesPayload
} from '../../src/shared/types';
import { acquireAttributeReplayLock, commitAttributeReplay, releaseAttributeReplayLock } from './attributeLocks';
import { encodeAttributeReplayChunks } from './attributeReplayChunks';
import { queryAllUnprocessedCandidates, queryAttributeDefinitions } from './attributeQueries';
import type { AttributeScoreStateRow, ComponentRow, FullReplayExternalIdRow, FullReplayGameAliasRow, FullReplayGameSourceRow, FullReplaySubjectSourceRow } from './attributeQueryShared';
import { ATTRIBUTE_QUESTION_SLOT_COUNT, toComponent } from './attributeQueryShared';
import { ATTRIBUTE_SCORE_MODEL_VERSION, type OnlineAttributeState } from './attributeScoring';
import {
  calculateAttributeReplay, mergeStateKey, pairStatKey,
  type CalculatedAttributeReplay, type FullReplayResponseRow, type ReplayPair,
} from './attributeReplayCalculation';
import type { Database } from './database';
import { attributeVoteWeight, queryAuthorizedAttributeVoters } from './attributeVoteWeights';

const rebuildStateStatement = (
  db: Database,
  json: string,
  timestamp: number,
) => db.statement(`
  INSERT INTO attribute_score_states
    (subject_id, attribute_id, score, rating_deviation, direct_sum, direct_count,
     comparison_count, decisive_comparison_count, evidence_count, model_version,
     updated_at, random_key, question_slot)
  SELECT value ->> 0, value ->> 1, value ->> 2, value ->> 3, value ->> 4, value ->> 5,
    value ->> 6, value ->> 7, value ->> 8, value ->> 9, ?,
    lower(hex(randomblob(16))), (abs(random()) % ${ATTRIBUTE_QUESTION_SLOT_COUNT}) + 1
  FROM json_each(?) WHERE true
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
`).bind(timestamp, json);

const replayStateRow = (subjectId: string, attributeId: string, state: OnlineAttributeState) => [
  subjectId, attributeId, state.score, state.ratingDeviation, state.directSum,
  state.directCount, state.comparisonCount, state.decisiveComparisonCount,
  state.evidenceCount, ATTRIBUTE_SCORE_MODEL_VERSION,
];

const stateMatches = (stored: AttributeScoreStateRow | undefined, next: OnlineAttributeState): boolean => {
  // Every value is recomputed from raw history. A changed model label alone
  // must not rewrite thousands of unchanged (especially unvoted) states.
  if (!stored) return false;
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

interface FullReplayPairSnapshotRow { active_generation: number; chunk_count: number; }

interface FullReplayPairSnapshotChunkRow { chunk_number: number; pairs_json: string; }

interface FullReplayStateSnapshotRow { active_generation: number; chunk_count: number; }

interface FullReplayStateSnapshotChunkRow { states_json: string; }

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
  const aliasesByGame = new Map<string, string[]>();
  for (const row of aliasResult.results ?? []) {
    const aliases = aliasesByGame.get(row.game_id) ?? [];
    aliases.push(row.alias);
    aliasesByGame.set(row.game_id, aliases);
    if (isChineseName(row.alias) && !firstChineseAliasByGame.has(row.game_id)) firstChineseAliasByGame.set(row.game_id, row.alias);
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
      aliases: [...new Set([row.game_id, ...components.map((component) => component.gameId)]
        .flatMap((gameId) => gameId ? aliasesByGame.get(gameId) ?? [] : []))].sort(),
      gameId: row.game_id ?? undefined,
      gameSlug: game?.slug,
      ...(bggIds.size ? { bggIds: [...bggIds].sort((left, right) => left - right) } : {}),
      components,
    });
  }
  return subjects;
};

export const queryFullReplayMetadata = async (db: Database) => {
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

const prepareFullReplayStateBaseline = (
  db: Database,
  states: Map<string, OnlineAttributeState>,
  generation: number,
  maxChunkBytes?: number,
) => {
  const rows = [...states.entries()].map(([key, state]) => {
    const separator = key.indexOf('\u0000');
    return replayStateRow(key.slice(0, separator), key.slice(separator + 1), state);
  });
  const chunks = encodeAttributeReplayChunks(rows, maxChunkBytes);
  return [
    db.statement('DELETE FROM attribute_replay_state_snapshot_chunks WHERE generation = ?').bind(generation),
    ...chunks.map((entries, index) => db.statement(`
      INSERT INTO attribute_replay_state_snapshot_chunks (generation, chunk_number, states_json)
      VALUES (?, ?, ?)
    `).bind(generation, index, entries)),
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
  ];
};

const queryFullReplayHistory = async (db: Database): Promise<FullReplayResponseRow[]> => {
  const authorized = await queryAuthorizedAttributeVoters(db);
  // The canonical response table is read exactly once. Filtering active
  // attributes and expanding each response happen in Worker memory.
  const responses = await db.statement(`SELECT response_id, attribute_id, subject_a_id, subject_b_id,
    rating_a, rating_b, comparison, created_at, actor_id FROM attribute_vote_responses`).all<Omit<FullReplayResponseRow, 'weight'> & { actor_id: string | null }>();
  return (responses.results ?? []).map(({ actor_id, ...row }) => ({
    ...row,
    weight: attributeVoteWeight(actor_id, authorized.has(actor_id ?? '')),
  }));
};

const queryFullReplayPairBaseline = async (db: Database) => {
  const state = await db.statement('SELECT active_generation, chunk_count FROM attribute_replay_snapshot_state WHERE id = 1')
    .first<FullReplayPairSnapshotRow>();
  if (!state) throw new Error('attribute_replay_baseline_unavailable');
  const chunks = await db.statement('SELECT chunk_number, pairs_json FROM attribute_replay_snapshot_chunks WHERE generation = ? ORDER BY chunk_number')
    .bind(state.active_generation).all<FullReplayPairSnapshotChunkRow>();
  const rowsByChunk = chunks.results ?? [];
  if (rowsByChunk.length !== Number(state.chunk_count) || rowsByChunk.some((row, index) => row.chunk_number !== index)) {
    throw new Error('incomplete_attribute_replay_baseline');
  }
  const pairs = new Map<string, StoredPairStatRow>();
  for (const chunk of rowsByChunk) {
    const rows = parseFullReplayJson(chunk.pairs_json);
    if (!Array.isArray(rows)) throw new Error('invalid_attribute_replay_baseline');
    for (const row of rows) {
      if (!Array.isArray(row) || row.length !== 4 || row.some((value, index) => index < 3 ? typeof value !== 'string' : typeof value !== 'number')) {
        throw new Error('invalid_attribute_replay_baseline');
      }
      const [subjectAId, subjectBId, attributeId, comparisonCount] = row as [string, string, string, number];
      pairs.set(pairStatKey(subjectAId, subjectBId, attributeId), { subject_a_id: subjectAId, subject_b_id: subjectBId, attribute_id: attributeId, comparison_count: comparisonCount });
    }
  }
  return pairs;
};

const prepareFullReplayPairBaseline = (db: Database, pairs: ReplayPair[], generation: number, maxChunkBytes?: number) => {
  const rows = pairs.map((pair) => [pair.subjectAId, pair.subjectBId, pair.attributeId, pair.count]);
  const chunks = encodeAttributeReplayChunks(rows, maxChunkBytes);
  return [
    db.statement('DELETE FROM attribute_replay_snapshot_chunks WHERE generation = ?').bind(generation),
    ...chunks.map((json, index) => db.statement('INSERT INTO attribute_replay_snapshot_chunks (generation, chunk_number, pairs_json) VALUES (?, ?, ?)').bind(generation, index, json)),
    db.statement(`INSERT INTO attribute_replay_snapshot_state (id, active_generation, chunk_count, generated_at) VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET active_generation = excluded.active_generation, chunk_count = excluded.chunk_count, generated_at = excluded.generated_at`).bind(generation, chunks.length, generation),
    db.statement('DELETE FROM attribute_replay_snapshot_chunks WHERE generation <> ?').bind(generation),
  ];
};

const preparePairUpdates = (db: Database, changed: ReplayPair[], stale: StoredPairStatRow[], timestamp: number, maxChunkBytes?: number) => {
  const upserts = changed.length ? encodeAttributeReplayChunks(changed.map((pair) => [pair.subjectAId, pair.subjectBId, pair.attributeId, pair.count]), maxChunkBytes) : [];
  const deletes = stale.length ? encodeAttributeReplayChunks(stale.map((pair) => [pair.subject_a_id, pair.subject_b_id, pair.attribute_id]), maxChunkBytes) : [];
  return [
    ...upserts.map((json) => db.statement(`
      INSERT INTO attribute_pair_stats (subject_a_id, subject_b_id, attribute_id, comparison_count, updated_at)
      SELECT value ->> 0, value ->> 1, value ->> 2, value ->> 3, ? FROM json_each(?) WHERE true
      ON CONFLICT(subject_a_id, subject_b_id, attribute_id) DO UPDATE
      SET comparison_count = excluded.comparison_count, updated_at = excluded.updated_at
    `).bind(timestamp, json)),
    ...deletes.map((json) => db.statement(`
      DELETE FROM attribute_pair_stats WHERE (subject_a_id, subject_b_id, attribute_id) IN
        (SELECT value ->> 0, value ->> 1, value ->> 2 FROM json_each(?))
    `).bind(json)),
  ];
};

/** Calculate under the replay lock. Live tables only change when the caller commits the plan. */
export const prepareAttributeReplay = async (db: Database, timestamp: number, maxChunkBytes?: number) => {
  const [metadata, history, storedPairs, stateBaseline] = await Promise.all([
    queryFullReplayMetadata(db), queryFullReplayHistory(db), queryFullReplayPairBaseline(db), queryFullReplayStateBaseline(db),
  ]);
  return prepareCalculatedAttributeReplay(
    db, timestamp, metadata, calculateAttributeReplay(metadata.subjectIds, new Set(metadata.attributes.keys()), history),
    { maxChunkBytes, storedPairs, stateBaseline },
  );
};

export const prepareCalculatedAttributeReplay = async (
  db: Database,
  timestamp: number,
  metadata: Awaited<ReturnType<typeof queryFullReplayMetadata>>,
  { states, pairCounts }: CalculatedAttributeReplay,
  options: {
    maxChunkBytes?: number;
    storedPairs?: Awaited<ReturnType<typeof queryFullReplayPairBaseline>>;
    stateBaseline?: Awaited<ReturnType<typeof queryFullReplayStateBaseline>>;
    compareLiveStates?: boolean;
  } = {},
) => {
  const { maxChunkBytes, compareLiveStates } = options;
  const [storedPairs, stateBaseline] = await Promise.all([
    options.storedPairs ?? queryFullReplayPairBaseline(db),
    options.stateBaseline ?? (compareLiveStates ? queryLiveReplayStates(db) : queryFullReplayStateBaseline(db)),
  ]);
  const { attributes, subjects, candidates, throughVersion } = metadata;
  const stored = stateBaseline.states;
  const changedStates = [...states.entries()].map(([key, state]) => {
    const separator = key.indexOf('\u0000');
    return { subjectId: key.slice(0, separator), attributeId: key.slice(separator + 1), state };
  }).filter(({ subjectId, attributeId, state }) => !stateMatches(stored.get(mergeStateKey(subjectId, attributeId)), state));
  const staleStates = [...stored.values()].filter((state) => !states.has(mergeStateKey(state.subject_id, state.attribute_id)));
  const changedPairs = [...pairCounts.values()].filter((pair) => Number(storedPairs.get(pairStatKey(pair.subjectAId, pair.subjectBId, pair.attributeId))?.comparison_count) !== pair.count);
  const stalePairs = [...storedPairs.values()].filter((pair) => !pairCounts.has(pairStatKey(pair.subject_a_id, pair.subject_b_id, pair.attribute_id)));
  const changed = changedStates.length > 0 || staleStates.length > 0 || changedPairs.length > 0 || stalePairs.length > 0;
  const stateUpserts = changedStates.length ? encodeAttributeReplayChunks(
    changedStates.map(({ subjectId, attributeId, state }) => replayStateRow(subjectId, attributeId, state)), maxChunkBytes,
  ) : [];
  const stateDeletes = staleStates.length ? encodeAttributeReplayChunks(
    staleStates.map((state) => [state.subject_id, state.attribute_id]), maxChunkBytes,
  ) : [];
  const statements = [
    ...(changedStates.length || staleStates.length ? [db.statement('INSERT OR IGNORE INTO attribute_catalog_rebuild_mode (id) VALUES (1)')] : []),
    ...stateUpserts.map((json) => rebuildStateStatement(db, json, timestamp)),
    ...stateDeletes.map((json) => db.statement(`
      DELETE FROM attribute_score_states WHERE (subject_id, attribute_id) IN
        (SELECT value ->> 0, value ->> 1 FROM json_each(?))
    `).bind(json)),
    ...preparePairUpdates(db, changedPairs, stalePairs, timestamp, maxChunkBytes),
    ...(changedPairs.length || stalePairs.length ? prepareFullReplayPairBaseline(db, [...pairCounts.values()], timestamp, maxChunkBytes) : []),
    ...(changedStates.length || staleStates.length || !stateBaseline.available ? prepareFullReplayStateBaseline(db, states, timestamp, maxChunkBytes) : []),
    db.statement('DELETE FROM attribute_catalog_rebuild_mode WHERE id = 1'),
  ];
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
    statements,
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

// A resumed run can span many successful live responses. Compare against the
// actual table so a score equal to the previous checkpoint can still be fixed.
const queryLiveReplayStates = async (db: Database) => {
  const result = await db.statement(`
    SELECT subject_id, attribute_id, score, rating_deviation, direct_sum, direct_count,
      comparison_count, decisive_comparison_count, evidence_count, model_version
    FROM attribute_score_states
  `).all<AttributeScoreStateRow>();
  return {
    states: new Map((result.results ?? []).map((state) => [mergeStateKey(state.subject_id, state.attribute_id), state])),
    available: false,
  };
};

export const replayAllAttributeScores = async (db: Database, timestamp = Date.now()): Promise<AttributeReplayResult> => {
  const lock = await acquireAttributeReplayLock(db, timestamp);
  try {
    const { statements, ...replay } = await prepareAttributeReplay(db, timestamp);
    await commitAttributeReplay(db, lock, statements);
    return replay;
  } finally {
    await releaseAttributeReplayLock(db, lock);
  }
};
