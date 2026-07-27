import { REVIEW_FORMAT, REVIEW_SCHEMA_VERSION, reviewFileSchema, type ReviewContent, type ReviewFile } from './review';

const contentFields = [
  'statement', 'commonMistake', 'details', 'flowStage', 'playerCounts', 'playerCountNote',
  'editionNotes', 'editionNote', 'sourceLabel', 'sourceUrl', 'tagNames',
] as const;

const headers = [
  '__format', '__schema_version', '__dataset_version', '__exported_at', '__scope_json', '__batch_name',
  'action', 'reason', 'rule_id', 'game_id', 'game_name', 'game_slug',
  'base_updated_at', 'base_content_hash',
  ...contentFields.flatMap((field) => [`current_${field}`, `proposed_${field}`]),
];

const csvCell = (input: unknown): string => {
  const raw = input == null ? '' : String(input);
  const value = /^[\r\t ]*[=+\-@]/.test(raw) ? `\t${raw}` : raw;
  return `"${value.replaceAll('"', '""')}"`;
};

const contentValue = (content: ReviewContent, field: (typeof contentFields)[number]): string => {
  if (field === 'tagNames' || field === 'editionNotes' || field === 'playerCounts') return (content[field] ?? []).join('｜');
  return String(content[field] ?? '');
};

export const serializeReviewCsv = (file: ReviewFile): string => {
  const rows = file.items.map((item) => {
    const row: Record<string, unknown> = {
      __format: REVIEW_FORMAT,
      __schema_version: REVIEW_SCHEMA_VERSION,
      __dataset_version: file.datasetVersion,
      __exported_at: file.exportedAt,
      __scope_json: JSON.stringify(file.scope),
      __batch_name: file.name,
      action: item.action,
      reason: item.reason,
      rule_id: item.target.id,
      game_id: item.target.gameId,
      game_name: item.target.gameName,
      game_slug: item.target.gameSlug,
      base_updated_at: item.base.updatedAt,
      base_content_hash: item.base.contentHash,
    };
    for (const field of contentFields) {
      row[`current_${field}`] = contentValue(item.current, field);
      row[`proposed_${field}`] = contentValue(item.proposed, field);
    }
    return headers.map((header) => csvCell(row[header])).join(',');
  });
  return `\uFEFF${headers.map(csvCell).join(',')}\r\n${rows.join('\r\n')}`;
};

export const parseCsvRows = (input: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = input.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell.replace(/\r$/, ''));
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += character;
  }
  row.push(cell.replace(/\r$/, ''));
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
};

const nullable = (value: string): string | null => value.trim() || null;
const contentFromRow = (row: Record<string, string>, prefix: 'current' | 'proposed'): ReviewContent => ({
  statement: row[`${prefix}_statement`] ?? '',
  commonMistake: nullable(row[`${prefix}_commonMistake`] ?? ''),
  details: nullable(row[`${prefix}_details`] ?? ''),
  flowStage: (row[`${prefix}_flowStage`] || 'uncategorized') as ReviewContent['flowStage'],
  playerCounts: (row[`${prefix}_playerCounts`] ?? '').split(/[｜|]/).map(Number).filter((value) => Number.isInteger(value) && value >= 1 && value <= 8),
  playerCountNote: nullable(row[`${prefix}_playerCountNote`] ?? ''),
  editionNotes: (row[`${prefix}_editionNotes`] ?? '').split(/[｜|]/).map((value) => value.trim()).filter(Boolean),
  editionNote: nullable(row[`${prefix}_editionNote`] ?? ''),
  sourceLabel: nullable(row[`${prefix}_sourceLabel`] ?? ''),
  sourceUrl: nullable(row[`${prefix}_sourceUrl`] ?? ''),
  tagNames: (row[`${prefix}_tagNames`] ?? '').split(/[｜|]/).map((value) => value.trim()).filter(Boolean),
});

export const parseReviewCsv = (input: string): ReviewFile => {
  const rows = parseCsvRows(input);
  if (rows.length < 2) throw new Error('review_csv_empty');
  const header = rows[0];
  const records = rows.slice(1).map((values) =>
    Object.fromEntries(header.map((key, index) => {
      const value = values[index] ?? '';
      return [key, /^\t[\r\t ]*[=+\-@]/.test(value) ? value.slice(1) : value];
    })));
  const first = records[0];
  const file = {
    format: first.__format,
    schemaVersion: Number(first.__schema_version),
    name: first.__batch_name,
    exportedAt: Number(first.__exported_at),
    datasetVersion: first.__dataset_version,
    scope: JSON.parse(first.__scope_json || '{}') as Record<string, unknown>,
    instructions: [
      '只修改 proposed_ 開頭欄位、reason 與 action。',
      '要提出修改時把 action 改為 propose；要隱藏資料時改為 hide。',
      '請勿修改 current_、rule_id、base_updated_at 或 base_content_hash。',
    ],
    items: records.map((row) => ({
      action: row.action,
      target: {
        type: 'rule',
        id: row.rule_id,
        gameId: row.game_id,
        gameName: row.game_name,
        gameSlug: row.game_slug,
      },
      base: {
        updatedAt: Number(row.base_updated_at),
        contentHash: row.base_content_hash,
      },
      current: contentFromRow(row, 'current'),
      proposed: contentFromRow(row, 'proposed'),
      reason: row.reason ?? '',
    })),
  };
  return reviewFileSchema.parse(file);
};
