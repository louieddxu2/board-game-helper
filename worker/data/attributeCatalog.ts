import type {
  AttributeCatalogChange,
  AttributeCatalogChangesPayload,
  AttributeCatalogPayload,
  AttributeDefinition,
  AttributeImportCandidate,
  AttributeMatrixValue,
  AttributeSubject,
  AttributesPayload,
} from '../../src/shared/types';
import type { Database, D1Result } from './database';
import {
  queryAttributeTableSourcePayload,
} from './attributes';

const MAX_ENTRIES_PER_CHUNK = 1000;
const MAX_CHUNK_BYTES = 1_000_000;
export const ATTRIBUTE_CATALOG_CHANGE_LIMIT = 32;
const textEncoder = new TextEncoder();

interface SnapshotStateRow {
  active_generation: number;
  through_version: number;
  chunk_count: number;
  attributes_json: string;
  score_model_version: string;
  generated_at: number;
}

interface SnapshotChunkRow {
  chunk_number: number;
  entries_json: string;
}

interface CatalogEntryRow {
  entry_key: string;
  catalog_version: number;
  entry_json: string | null;
  deleted: number;
}

interface SnapshotSubjectEntry {
  kind: 'subject';
  subject: AttributeSubject;
  values: AttributeMatrixValue[];
}

interface SnapshotCandidateEntry {
  kind: 'candidate';
  candidate: AttributeImportCandidate;
}

type SnapshotEntry = SnapshotSubjectEntry | SnapshotCandidateEntry;

export interface AttributeCatalogSnapshotQuery {
  state: D1Result<SnapshotStateRow>;
  chunks: D1Result<SnapshotChunkRow>;
}

const parseJson = (value: string): unknown => {
  try { return JSON.parse(value); } catch { throw new Error('invalid_attribute_catalog_json'); }
};

const parseSubject = (value: unknown): AttributeSubject | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Partial<AttributeSubject>;
  if (typeof row.id !== 'string' || typeof row.slug !== 'string' || typeof row.displayName !== 'string') return undefined;
  if (row.kind !== 'game' && row.kind !== 'configuration') return undefined;
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    displayName: row.displayName,
    ...(typeof row.secondaryName === 'string' ? { secondaryName: row.secondaryName } : {}),
    ...(typeof row.year === 'number' ? { year: row.year } : {}),
    ...(typeof row.thumbnailUrl === 'string' ? { thumbnailUrl: row.thumbnailUrl } : {}),
    ...(typeof row.externalSource === 'string' ? { externalSource: row.externalSource } : {}),
    ...(typeof row.externalId === 'string' ? { externalId: row.externalId } : {}),
    ...(Array.isArray(row.bggIds) ? {
      bggIds: [...new Set(row.bggIds.filter((id): id is number => Number.isSafeInteger(id) && id > 0))],
    } : {}),
    ...(typeof row.gameId === 'string' ? { gameId: row.gameId } : {}),
    ...(typeof row.gameSlug === 'string' ? { gameSlug: row.gameSlug } : {}),
    ...(Array.isArray(row.components) ? { components: row.components } : {}),
  };
};

const parseValue = (value: unknown): AttributeMatrixValue | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Partial<AttributeMatrixValue>;
  if (typeof row.subjectId !== 'string' || typeof row.attributeId !== 'string'
    || typeof row.score !== 'number' || typeof row.ratingDeviation !== 'number'
    || typeof row.directCount !== 'number' || typeof row.comparisonCount !== 'number'
    || typeof row.decisiveComparisonCount !== 'number' || typeof row.modelVersion !== 'string') return undefined;
  return {
    subjectId: row.subjectId,
    attributeId: row.attributeId,
    score: row.score,
    ratingDeviation: row.ratingDeviation,
    ...(typeof row.directAverage === 'number' ? { directAverage: row.directAverage } : {}),
    directCount: row.directCount,
    comparisonCount: row.comparisonCount,
    decisiveComparisonCount: row.decisiveComparisonCount,
    ...(typeof row.evidenceCount === 'number' ? { evidenceCount: row.evidenceCount } : {}),
    modelVersion: row.modelVersion,
  };
};

const parseAttribute = (value: unknown): AttributeDefinition | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.key !== 'string' || typeof row.name !== 'string'
    || typeof row.minValue !== 'number' || typeof row.maxValue !== 'number' || typeof row.sortOrder !== 'number') return undefined;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    ...(typeof row.shortDescription === 'string' ? { shortDescription: row.shortDescription } : {}),
    ...(typeof row.fullDescription === 'string' ? { fullDescription: row.fullDescription } : {}),
    minValue: row.minValue,
    maxValue: row.maxValue,
    sortOrder: row.sortOrder,
  };
};

const parseCandidateValues = (raw: unknown): Array<number | null> => {
  if (typeof raw !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((value) => typeof value === 'number' && Number.isFinite(value) ? value : null)
      : [];
  } catch {
    return [];
  }
};

const parseCandidate = (value: unknown): AttributeImportCandidate | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.displayName !== 'string'
    || (row.matchStatus !== 'pending' && row.matchStatus !== 'ambiguous' && row.matchStatus !== 'matched' && row.matchStatus !== 'skipped')
    || typeof row.sourceRowNumber !== 'number') return undefined;
  return {
    id: row.id,
    displayName: row.displayName,
    values: Array.isArray(row.values)
      ? row.values.map((item) => typeof item === 'number' && Number.isFinite(item) ? item : null)
      : parseCandidateValues(row.valuesJson),
    matchStatus: row.matchStatus,
    ...(typeof row.subjectId === 'string' ? { subjectId: row.subjectId } : {}),
    sourceRowNumber: row.sourceRowNumber,
  };
};

export const queryAttributeCatalogSnapshot = async (db: Database): Promise<AttributeCatalogSnapshotQuery> => {
  const state = await db.statement(`
    SELECT active_generation, through_version, chunk_count, attributes_json,
      score_model_version, generated_at
    FROM attribute_catalog_snapshot_state
    WHERE id = 1
  `).all<SnapshotStateRow>();
  const row = state.results?.[0];
  if (!row) return { state, chunks: { results: [] } };
  const chunks = await db.statement(`
    SELECT chunk_number, entries_json
    FROM attribute_catalog_snapshot_chunks
    WHERE generation = ?
    ORDER BY chunk_number
  `).bind(row.active_generation).all<SnapshotChunkRow>();
  return { state, chunks };
};

export const attributeCatalogPayload = ({ state, chunks }: AttributeCatalogSnapshotQuery): AttributeCatalogPayload => {
  const stateRow = state.results?.[0];
  if (!stateRow) throw new Error('attribute_catalog_unavailable');
  const chunkRows = chunks.results ?? [];
  if (chunkRows.length !== Number(stateRow.chunk_count)) throw new Error('incomplete_attribute_catalog_snapshot');
  const subjects = new Map<string, AttributeSubject>();
  const values = new Map<string, AttributeMatrixValue>();
  const candidates = new Map<string, AttributeImportCandidate>();
  chunkRows.forEach((row) => {
    const parsed = parseJson(row.entries_json);
    if (!Array.isArray(parsed)) throw new Error('invalid_attribute_catalog_chunk');
    (parsed as SnapshotEntry[]).forEach((entry) => {
      if (entry.kind === 'subject' && entry.subject?.id) {
        subjects.set(entry.subject.id, entry.subject);
        entry.values.forEach((value) => values.set(`${value.subjectId}:${value.attributeId}`, value));
      }
      if (entry.kind === 'candidate') {
        // Migration 0051 wrote candidate entries in the flat delta shape,
        // while weekly TypeScript rebuilds use the nested snapshot shape.
        // Accept both so generation 1 does not silently lose pending rows.
        const candidate = parseCandidate(entry.candidate) ?? parseCandidate(entry);
        if (candidate) candidates.set(candidate.id, candidate);
      }
    });
  });
  const attributes = parseJson(stateRow.attributes_json);
  if (!Array.isArray(attributes)) throw new Error('invalid_attribute_catalog_attributes');
  return {
    generation: Number(stateRow.active_generation),
    throughVersion: Number(stateRow.through_version),
    generatedAt: Number(stateRow.generated_at),
    attributes: attributes as AttributesPayload['attributes'],
    subjects: [...subjects.values()].sort((left, right) => left.displayName.localeCompare(right.displayName, 'zh-Hant') || left.id.localeCompare(right.id)),
    values: [...values.values()],
    candidates: [...candidates.values()].sort((left, right) => left.sourceRowNumber - right.sourceRowNumber || left.id.localeCompare(right.id)),
    activities: [],
    scoreModelVersion: stateRow.score_model_version,
  };
};

export const queryAttributeCatalogChanges = (
  db: Database,
  afterVersion: number,
  limit = ATTRIBUTE_CATALOG_CHANGE_LIMIT,
): Promise<D1Result<CatalogEntryRow>> => db.statement(`
  SELECT entry_key, catalog_version, entry_json, deleted
  FROM attribute_catalog_entries
  WHERE catalog_version > ?
  ORDER BY catalog_version, entry_key
  LIMIT ?
`).bind(afterVersion, limit).all<CatalogEntryRow>();

export const attributeCatalogChangesPayload = (
  result: D1Result<CatalogEntryRow>,
  afterVersion: number,
  limit = ATTRIBUTE_CATALOG_CHANGE_LIMIT,
): AttributeCatalogChangesPayload => {
  const changes: AttributeCatalogChange[] = [];
  for (const row of result.results ?? []) {
    if (row.deleted || !row.entry_json) {
      changes.push({ entryKey: row.entry_key, catalogVersion: Number(row.catalog_version), deleted: true });
      continue;
    }
    const parsed = parseJson(row.entry_json) as Record<string, unknown>;
    if (parsed.kind === 'value') {
      const value = parseValue(parsed);
      if (!value) continue;
      changes.push({
        entryKey: row.entry_key,
        catalogVersion: Number(row.catalog_version),
        deleted: false,
        value,
        subject: parseSubject(parsed.subject),
      });
    } else if (parsed.kind === 'attribute') {
      const attribute = parseAttribute(parsed.attribute);
      if (!attribute) continue;
      changes.push({
        entryKey: row.entry_key,
        catalogVersion: Number(row.catalog_version),
        deleted: false,
        attribute,
      });
    } else if (parsed.kind === 'subject') {
      const subject = parseSubject(parsed.subject);
      if (!subject) continue;
      changes.push({
        entryKey: row.entry_key,
        catalogVersion: Number(row.catalog_version),
        deleted: false,
        subject,
      });
    } else if (parsed.kind === 'candidate') {
      const candidate = parseCandidate(parsed);
      if (!candidate) continue;
      changes.push({ entryKey: row.entry_key, catalogVersion: Number(row.catalog_version), deleted: false, candidate });
    }
  }
  return {
    changes,
    throughVersion: result.results?.at(-1)?.catalog_version != null
      ? Number(result.results.at(-1)?.catalog_version)
      : afterVersion,
    hasMore: (result.results ?? []).length === limit,
  };
};

export const chunkAttributeCatalog = (entries: SnapshotEntry[]): SnapshotEntry[][] => {
  const chunks: SnapshotEntry[][] = [];
  let current: SnapshotEntry[] = [];
  let currentBytes = 2;
  for (const entry of entries) {
    const entryBytes = textEncoder.encode(JSON.stringify(entry)).byteLength;
    if (entryBytes + 2 > MAX_CHUNK_BYTES) throw new Error('attribute_catalog_entry_too_large');
    const nextBytes = currentBytes + entryBytes + (current.length ? 1 : 0);
    if (current.length && (current.length >= MAX_ENTRIES_PER_CHUNK || nextBytes > MAX_CHUNK_BYTES)) {
      chunks.push(current);
      current = [];
      currentBytes = 2;
    }
    current.push(entry);
    currentBytes += entryBytes + (current.length > 1 ? 1 : 0);
  }
  if (current.length) chunks.push(current);
  if (!chunks.length) chunks.push([]);
  return chunks;
};

export const rebuildAttributeCatalog = async (db: Database, timestamp = Date.now()): Promise<AttributeCatalogPayload> => {
  // Read the cursor before the source rows, matching the game catalog's
  // snapshot semantics: votes that happen during the build remain deltas.
  const clock = await db.statement('SELECT current_version FROM attribute_catalog_clock WHERE id = 1')
    .first<{ current_version: number }>();
  if (!clock) throw new Error('attribute_catalog_clock_unavailable');
  const throughVersion = Number(clock.current_version);
  const source = await queryAttributeTableSourcePayload(db);
  const valuesBySubject = new Map<string, AttributeMatrixValue[]>();
  source.values.forEach((value) => {
    const values = valuesBySubject.get(value.subjectId) ?? [];
    values.push(value);
    valuesBySubject.set(value.subjectId, values);
  });
  const entries: SnapshotEntry[] = source.subjects.map((subject) => ({
    kind: 'subject',
    subject,
    values: valuesBySubject.get(subject.id) ?? [],
  }));
  source.candidates.forEach((candidate) => entries.push({ kind: 'candidate', candidate }));
  const chunks = chunkAttributeCatalog(entries);
  const generation = timestamp;
  const statements = [db.statement('DELETE FROM attribute_catalog_snapshot_chunks WHERE generation = ?').bind(generation)];
  statements.push(...chunks.map((chunk, chunkNumber) => db.statement(`
    INSERT OR REPLACE INTO attribute_catalog_snapshot_chunks (generation, chunk_number, entries_json)
    VALUES (?, ?, ?)
  `).bind(generation, chunkNumber, JSON.stringify(chunk))));
  statements.push(db.statement(`
    INSERT INTO attribute_catalog_snapshot_state
      (id, active_generation, through_version, chunk_count, attributes_json, score_model_version, generated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      active_generation = excluded.active_generation,
      through_version = excluded.through_version,
      chunk_count = excluded.chunk_count,
      attributes_json = excluded.attributes_json,
      score_model_version = excluded.score_model_version,
      generated_at = excluded.generated_at
  `).bind(generation, throughVersion, chunks.length, JSON.stringify(source.attributes), source.scoreModelVersion ?? 'glicko-rd-v1', timestamp));
  statements.push(db.statement('DELETE FROM attribute_catalog_snapshot_chunks WHERE generation <> ?').bind(generation));
  await db.batch(statements);
  return {
    ...source,
    generation,
    throughVersion,
    generatedAt: timestamp,
  };
};
