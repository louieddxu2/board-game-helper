import { encodeAttributeReplayChunks } from './attributeReplayChunks';
import { compareAttributeReplayEvents, decodeAttributeReplayVotes, expandAttributeReplayHistory, type FullReplayHistoryRow } from './attributeReplayCalculation';
import type { Database } from './database';

interface Position { chunk: number; offset: number; }

type OrderedEvent = [
  time: number, streamId: string, subjectAId: string, subjectBId: string | null,
  value: number | NonNullable<FullReplayHistoryRow['comparison']>, weight: number,
];

export type ScoringCursor = { phase: 'ratings' | 'comparisons'; pass: number; chunk: number; lastEventAt: number | null };
export type OrderingCursor =
  | { phase: 'sort'; page: number; chunk: number; runs: number }
  | { phase: 'merge'; pass: number; runs: number; firstRun: number; output: number; inputs: Position[] };
export type CalculationCursor = OrderingCursor | ScoringCursor | { phase: 'complete'; lastEventAt: number | null };

const MERGE_WIDTH = 4;
const MERGE_EVENTS_PER_STEP = 4_000;

export const initialOrderingCursor: OrderingCursor = { phase: 'sort', page: -1, chunk: -1, runs: 0 };

export const queryCalculationCursor = async (db: Database, attributeId: string) => {
  const row = await db.statement('SELECT cursor_json FROM attribute_replay_calculation WHERE attribute_id = ?')
    .bind(attributeId).first<{ cursor_json: string }>();
  return row ? JSON.parse(row.cursor_json) as CalculationCursor : null;
};

export const queryOrderedCalculationInProgress = async (db: Database) => Boolean(await db.statement(`
  SELECT 1 FROM attribute_replay_calculation WHERE json_extract(cursor_json, '$.phase') <> 'complete' LIMIT 1
`).first());

export const prepareCalculationCursor = (db: Database, attributeId: string, cursor: CalculationCursor) => db.statement(`
  INSERT INTO attribute_replay_calculation (attribute_id, cursor_json) VALUES (?, ?)
  ON CONFLICT(attribute_id) DO UPDATE SET cursor_json = excluded.cursor_json
`).bind(attributeId, JSON.stringify(cursor));

const encodeEvents = (events: FullReplayHistoryRow[]) => encodeAttributeReplayChunks(events.map(
  (event): OrderedEvent => [
    event.created_at, event.stream_id, event.subject_a_id, event.subject_b_id,
    event.kind === 'rating' ? event.value! : event.comparison!, event.weight,
  ],
));

const decodeEvents = (attributeId: string, payload: string): FullReplayHistoryRow[] =>
  (JSON.parse(payload) as OrderedEvent[]).map(([created_at, stream_id, subject_a_id, subject_b_id, result, weight]) => ({
    created_at, stream_id, subject_a_id, subject_b_id, attribute_id: attributeId, weight,
    kind: typeof result === 'number' ? 'rating' : 'comparison',
    value: typeof result === 'number' ? result : null,
    comparison: typeof result === 'number' ? null : result,
  }));

export const queryOrderedReplayEvents = async (db: Database, attributeId: string, pass: number, run: number, chunk: number) => {
  const row = await db.statement(`
    SELECT payload FROM attribute_replay_ordered_chunks
    WHERE attribute_id = ? AND pass = ? AND run = ? AND chunk_number = ?
  `).bind(attributeId, pass, run, chunk).first<{ payload: string }>();
  return row ? decodeEvents(attributeId, row.payload) : [];
};

const prepareOrderedChunks = (db: Database, attributeId: string, pass: number, run: number, start: number, chunks: string[]) =>
  chunks.map((payload, index) => db.statement(`
    INSERT INTO attribute_replay_ordered_chunks (attribute_id, pass, run, chunk_number, payload)
    VALUES (?, ?, ?, ?, ?)
  `).bind(attributeId, pass, run, start + index, payload));

const beginMerge = (pass: number, runs: number, firstRun = 0): CalculationCursor => runs <= 1
  ? { phase: 'ratings', pass, chunk: 0, lastEventAt: null }
  : {
    phase: 'merge', pass, runs, firstRun, output: 0,
    inputs: Array.from({ length: Math.min(MERGE_WIDTH, runs - firstRun) }, () => ({ chunk: 0, offset: 0 })),
  };

export const prepareOrderReplayStep = async (db: Database, attributeId: string, cursor: OrderingCursor) => {
  if (cursor.phase === 'sort') {
    const row = await db.statement(`
      SELECT page, chunk_number, payload FROM attribute_replay_work_chunks
      WHERE kind = 'history' AND attribute_id = ? AND (page, chunk_number) > (?, ?)
      ORDER BY page, chunk_number LIMIT 1
    `).bind(attributeId, cursor.page, cursor.chunk).first<{ page: number; chunk_number: number; payload: string }>();
    if (!row) return [prepareCalculationCursor(db, attributeId, beginMerge(0, cursor.runs))];
    const history = expandAttributeReplayHistory(decodeAttributeReplayVotes(attributeId, row.payload));
    return [
      ...(history.length ? prepareOrderedChunks(db, attributeId, 0, cursor.runs, 0, encodeEvents(history)) : []),
      prepareCalculationCursor(db, attributeId, {
        phase: 'sort', page: row.page, chunk: row.chunk_number, runs: cursor.runs + (history.length ? 1 : 0),
      }),
    ];
  }

  const { pass, firstRun, runs, output } = cursor;
  const outputRun = Math.floor(firstRun / MERGE_WIDTH);
  const nextGroup = firstRun + MERGE_WIDTH;
  const finishGroup = () => {
    const next = nextGroup < runs ? beginMerge(pass, runs, nextGroup) : beginMerge(pass + 1, outputRun + 1);
    return [
      ...(nextGroup >= runs ? [db.statement('DELETE FROM attribute_replay_ordered_chunks WHERE attribute_id = ? AND pass = ?')
        .bind(attributeId, pass)] : []),
      prepareCalculationCursor(db, attributeId, next),
    ];
  };
  if (cursor.inputs.length === 1) {
    return [
      db.statement(`
        INSERT INTO attribute_replay_ordered_chunks (attribute_id, pass, run, chunk_number, payload)
        SELECT attribute_id, ?, ?, chunk_number, payload FROM attribute_replay_ordered_chunks
        WHERE attribute_id = ? AND pass = ? AND run = ?
      `).bind(pass + 1, outputRun, attributeId, pass, firstRun),
      ...finishGroup(),
    ];
  }

  const inputs = cursor.inputs.map((position) => ({ ...position }));
  const loadPage = async (index: number) => {
    const position = inputs[index];
    if (position.chunk < 0) return [];
    const events = await queryOrderedReplayEvents(db, attributeId, pass, firstRun + index, position.chunk);
    if (!events.length) position.chunk = -1;
    return events;
  };
  const pages = await Promise.all(inputs.map((_, index) => loadPage(index)));
  if (inputs.every((position) => position.chunk < 0)) return finishGroup();

  // Equal comparator keys retain the original run order, just as in stable
  // full replay. Bound both output size and input refills per checkpoint.
  const events: FullReplayHistoryRow[] = [];
  let refills = 0;
  while (events.length < MERGE_EVENTS_PER_STEP) {
    let next = -1;
    for (let index = 0; index < pages.length; index += 1) {
      const head = pages[index][inputs[index].offset];
      if (head && (next < 0 || compareAttributeReplayEvents(head, pages[next][inputs[next].offset]) < 0)) next = index;
    }
    if (next < 0) break;
    const position = inputs[next];
    events.push(pages[next][position.offset++]);
    if (position.offset === pages[next].length) {
      position.chunk += 1;
      position.offset = 0;
      if (events.length === MERGE_EVENTS_PER_STEP || refills === MERGE_WIDTH) break;
      pages[next] = await loadPage(next);
      refills += 1;
    }
  }
  const chunks = encodeEvents(events);
  return [
    ...prepareOrderedChunks(db, attributeId, pass + 1, outputRun, output, chunks),
    ...(inputs.every((position) => position.chunk < 0)
      ? finishGroup()
      : [prepareCalculationCursor(db, attributeId, { ...cursor, inputs, output: output + chunks.length })]),
  ];
};
