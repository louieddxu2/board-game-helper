import type { AttributeCatalogPayload, AttributeExtremeExamples, AttributeQuestion, AttributeScoreExample, AttributeSubject } from '../shared/types';
import { attributeDirectRatingKey } from './attributeDirectRatings';

export const MAX_ATTRIBUTE_COLLECTION_CSV_BYTES = 5 * 1024 * 1024;

export interface ParsedCsvCollection {
  bggIds: number[];
  rowCount: number;
  skippedRows: number;
  idColumn: string;
}

export interface ScopedAttributeQuestionOptions {
  excludeSubjectAId?: string;
  excludeSubjectBId?: string;
  excludeAttributeId?: string;
  fixedSubjectAId?: string;
  fixedSubjectBId?: string;
  fixedAttributeId?: string;
  excludedDirectRatingKeys?: ReadonlySet<string>;
}

export interface ScopedAttributeQuestionSelection {
  subjectAId: string;
  subjectBId: string;
  attributeId: string;
}

export interface DeferredAttributeSubjectPreference {
  subjectId: string;
  bggIds: number[];
  skipCount: number;
  skippedAt: number;
  eligibleAfterQuestion: number;
  eligibleAfterAt: number;
}

/**
 * Keep the local question pool bounded while retaining enough low-confidence
 * candidates to make the random draw visible. This is a browser-side limit
 * only; it does not change the D1 request or response size.
 */
export const LOCAL_ATTRIBUTE_QUESTION_POOL_LIMIT = 200;

const normalizeHeader = (value: string) => value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s_-]+/g, '');

/** Small RFC-4180-compatible parser for the collection export we support. */
export const parseCsvRows = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((value) => value.trim())) rows.push(row);
  }
  return rows;
};

const parseBggId = (value: string | undefined) => {
  const normalized = value?.trim() ?? '';
  if (!/^\d+$/.test(normalized)) return undefined;
  const id = Number(normalized);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
};

export const parseGeekGroupCollectionCsv = (text: string): ParsedCsvCollection => {
  if (new TextEncoder().encode(text).byteLength > MAX_ATTRIBUTE_COLLECTION_CSV_BYTES) throw new Error('csv_file_too_large');
  const rows = parseCsvRows(text);
  const header = rows[0] ?? [];
  const idColumnIndex = header.findIndex((value) => ['gameid', 'bggid', 'objectid'].includes(normalizeHeader(value)));
  if (idColumnIndex < 0) throw new Error('csv_game_id_column_missing');
  const bggIds = new Set<number>();
  let skippedRows = 0;
  rows.slice(1).forEach((row) => {
    const bggId = parseBggId(row[idColumnIndex]);
    if (bggId == null) skippedRows += 1;
    else bggIds.add(bggId);
  });
  if (!bggIds.size) throw new Error('csv_no_game_ids');
  return {
    bggIds: [...bggIds].sort((left, right) => left - right),
    rowCount: Math.max(0, rows.length - 1),
    skippedRows,
    idColumn: header[idColumnIndex].replace(/^\uFEFF/, '').trim(),
  };
};

export const attributeSubjectBggIds = (subject: AttributeSubject) => {
  const ids = new Set(subject.bggIds ?? []);
  const base = subject.components?.find((component) => component.type === 'base' && component.bggId != null);
  if (base?.bggId != null) ids.add(base.bggId);
  if (subject.externalSource?.toLowerCase() === 'bgg' && subject.externalId && /^\d+$/.test(subject.externalId)) ids.add(Number(subject.externalId));
  return [...ids].filter((id) => Number.isSafeInteger(id) && id > 0);
};

export const matchCollectionSubjects = (catalog: AttributeCatalogPayload, bggIds: number[]) => {
  const byBggId = new Map<number, Set<string>>();
  catalog.subjects
    .forEach((subject) => {
      attributeSubjectBggIds(subject).forEach((bggId) => {
        const subjectIds = byBggId.get(bggId) ?? new Set<string>();
        subjectIds.add(subject.id);
        byBggId.set(bggId, subjectIds);
      });
    });
  const subjectIds = [...new Set(bggIds.flatMap((id) => [...(byBggId.get(id) ?? [])]))];
  return { subjectIds, matchedBggIds: [...new Set(bggIds.filter((id) => byBggId.has(id)))] };
};

const randomSample = <T>(items: T[], limit: number, random: () => number): T[] => {
  const pool = [...items];
  const selected: T[] = [];
  while (pool.length && selected.length < limit) {
    const index = Math.min(pool.length - 1, Math.floor(Math.max(0, Math.min(1 - Number.EPSILON, random())) * pool.length));
    selected.push(pool.splice(index, 1)[0]);
  }
  return selected;
};

/**
 * Selects the 0-2 and 8-10 reference games from the attribute catalog that
 * is already cached in IndexedDB. A collection scope is preferred when it
 * has enough examples; missing positions fall back to the complete catalog.
 */
export const chooseScopedExtremeExamples = (
  catalog: AttributeCatalogPayload,
  attributeId: string,
  scopedSubjectIds?: string[],
  random: () => number = Math.random,
): AttributeExtremeExamples => {
  const subjects = new Map(catalog.subjects.map((subject) => [subject.id, subject]));
  const scoped = scopedSubjectIds ? new Set(scopedSubjectIds) : undefined;
  const candidates = catalog.values
    .filter((value) => value.attributeId === attributeId && (value.evidenceCount ?? 0) > 0)
    .flatMap((value): AttributeScoreExample[] => {
      const subject = subjects.get(value.subjectId);
      return subject ? [{ subject, score: Number(value.score.toFixed(2)) }] : [];
    });
  const selectBand = (predicate: (score: number) => boolean) => {
    const eligible = candidates.filter((example) => predicate(example.score));
    const preferred = scoped ? eligible.filter((example) => scoped.has(example.subject.id)) : eligible;
    const selected = randomSample(preferred, 2, random);
    if (selected.length === 2 || !scoped) return selected;
    const selectedIds = new Set(selected.map((example) => example.subject.id));
    return [...selected, ...randomSample(
      eligible.filter((example) => !selectedIds.has(example.subject.id)),
      2 - selected.length,
      random,
    )];
  };
  return {
    lowest: selectBand((score) => score >= 0 && score <= 2),
    highest: selectBand((score) => score >= 8 && score <= 10),
  };
};

/**
 * Applies local cooldowns to either the complete voting catalog or a
 * collection intersection. If fewer than two subjects remain, the subjects
 * closest to becoming eligible are released locally; callers never need a
 * server-side redraw loop.
 */
export const availableAttributeSubjectIds = (
  catalog: AttributeCatalogPayload,
  scopedSubjectIds: string[] | undefined,
  deferred: DeferredAttributeSubjectPreference[],
  questionNumber: number,
  _timestamp = Date.now(),
) => {
  const scoped = scopedSubjectIds ? new Set(scopedSubjectIds) : undefined;
  const candidates = catalog.subjects.filter((subject) => !scoped || scoped.has(subject.id));
  const candidateIds = new Set(candidates.map((subject) => subject.id));
  const byBggId = new Map<number, string>();
  candidates.forEach((subject) => attributeSubjectBggIds(subject).forEach((bggId) => {
    if (!byBggId.has(bggId)) byBggId.set(bggId, subject.id);
  }));
  const blocked = deferred.flatMap((preference) => {
    const currentSubjectId = candidateIds.has(preference.subjectId)
      ? preference.subjectId
      : preference.bggIds.map((bggId) => byBggId.get(bggId)).find(Boolean);
    if (!currentSubjectId) return [];
    const eligible = questionNumber >= preference.eligibleAfterQuestion;
    return eligible ? [] : [{ subjectId: currentSubjectId, preference }];
  });
  const blockedIds = new Set(blocked.map((entry) => entry.subjectId));
  const available = candidates.map((subject) => subject.id).filter((subjectId) => !blockedIds.has(subjectId));
  if (available.length >= 2) return available;
  blocked
    .sort((left, right) => left.preference.eligibleAfterQuestion - right.preference.eligibleAfterQuestion
      || left.preference.eligibleAfterAt - right.preference.eligibleAfterAt)
    .forEach(({ subjectId }) => {
      if (available.length < 2 && !available.includes(subjectId)) available.push(subjectId);
    });
  return available;
};

const weightedChoice = <T>(items: Array<{ item: T; weight: number }>, randomValue: number) => {
  const total = items.reduce((sum, item) => sum + Math.max(Number.EPSILON, item.weight), 0);
  let cursor = Math.min(1 - Number.EPSILON, Math.max(0, randomValue)) * total;
  for (const item of items) {
    cursor -= Math.max(Number.EPSILON, item.weight);
    if (cursor < 0) return item.item;
  }
  return items.at(-1)?.item;
};

const pairIsExcluded = (left: string, right: string, attributeId: string, options: ScopedAttributeQuestionOptions) =>
  options.excludeAttributeId === attributeId
  && ((left === options.excludeSubjectAId && right === options.excludeSubjectBId)
    || (left === options.excludeSubjectBId && right === options.excludeSubjectAId));

const isDirectlyRated = (subjectId: string, attributeId: string, options: ScopedAttributeQuestionOptions) =>
  options.excludedDirectRatingKeys?.has(attributeDirectRatingKey(subjectId, attributeId)) ?? false;

/**
 * Selects a question entirely from the weekly attribute catalog already in
 * IndexedDB. The server is called only afterwards with the selected subject
 * and attribute IDs, so an imported list never becomes a large D1 query
 * parameter.
 */
export const chooseScopedAttributeQuestion = (
  catalog: AttributeCatalogPayload,
  subjectIds: string[],
  options: ScopedAttributeQuestionOptions = {},
  randomValue = Math.random(),
): ScopedAttributeQuestionSelection | null => {
  const allowedSubjectIds = new Set(subjectIds);
  const availableSubjects = catalog.subjects.filter((subject) => allowedSubjectIds.has(subject.id));
  if (availableSubjects.length < 2 || !catalog.attributes.length) return null;
  const valueMap = new Map(catalog.values.map((value) => [`${value.subjectId}\u0000${value.attributeId}`, value]));
  const state = (subjectId: string, attributeId: string) => {
    const value = valueMap.get(`${subjectId}\u0000${attributeId}`);
    return { score: value?.score ?? 5, ratingDeviation: value?.ratingDeviation ?? 3, comparisonCount: value?.comparisonCount ?? 0 };
  };
  const attributeIds = options.fixedAttributeId
    ? catalog.attributes.some((attribute) => attribute.id === options.fixedAttributeId) ? [options.fixedAttributeId] : []
    : catalog.attributes.map((attribute) => attribute.id);
  if (!attributeIds.length) return null;

  let seedId = options.fixedSubjectAId ?? options.fixedSubjectBId;
  let attributeId = options.fixedAttributeId;
  if (!seedId) {
    const ranked = availableSubjects.flatMap((subject) => attributeIds.map((candidateAttributeId) => ({
      subjectId: subject.id,
      attributeId: candidateAttributeId,
      ...state(subject.id, candidateAttributeId),
    })))
      .filter((candidate) => !isDirectlyRated(candidate.subjectId, candidate.attributeId, options))
      .sort((left, right) => right.ratingDeviation - left.ratingDeviation);
    if (!ranked.length) return null;
    const pool = ranked.slice(0, Math.min(LOCAL_ATTRIBUTE_QUESTION_POOL_LIMIT, ranked.length));
    const seed = pool[Math.floor(randomValue * pool.length)] ?? ranked[0];
    seedId = seed.subjectId;
    attributeId = seed.attributeId;
  }
  if (!attributeId) attributeId = attributeIds[Math.floor(randomValue * attributeIds.length)];
  if (!seedId || !attributeId) return null;

  if (options.fixedSubjectAId && options.fixedSubjectBId) {
    if (options.fixedSubjectAId === options.fixedSubjectBId || pairIsExcluded(options.fixedSubjectAId, options.fixedSubjectBId, attributeId, options)) return null;
    return { subjectAId: options.fixedSubjectAId, subjectBId: options.fixedSubjectBId, attributeId };
  }

  const excluded = new Set([seedId, options.excludeSubjectAId, options.excludeSubjectBId].filter((id): id is string => Boolean(id)));
  const seedState = state(seedId, attributeId);
  const candidates = availableSubjects
    .filter((subject) => !excluded.has(subject.id) && !isDirectlyRated(subject.id, attributeId!, options))
    .map((subject) => {
      const candidateState = state(subject.id, attributeId);
      const distance = Math.abs(seedState.score - candidateState.score);
      return {
        subjectId: subject.id,
        weight: (1 + seedState.ratingDeviation + candidateState.ratingDeviation)
          * Math.exp(-distance / 2)
          / Math.sqrt(1 + candidateState.comparisonCount),
      };
    })
    .filter((candidate) => !pairIsExcluded(seedId!, candidate.subjectId, attributeId!, options));
  if (!candidates.length) return null;
  const chosen = weightedChoice(candidates.map((candidate) => ({ item: candidate.subjectId, weight: candidate.weight })), randomValue);
  if (!chosen) return null;
  return options.fixedSubjectBId
    ? { subjectAId: chosen, subjectBId: seedId, attributeId }
    : { subjectAId: seedId, subjectBId: chosen, attributeId };
};
