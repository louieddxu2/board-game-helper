import { createHash } from 'node:crypto';

export interface LegacyRecord {
  rowNumber: number;
  timestamp: string;
  timestampMs: number;
  gameName: string;
  ruleText: string;
  category: string;
  declaredCount?: number;
  sourceLabel: string;
  sourceUrl: string;
}

export const normalizeLegacyName = (value: string): string => value
  .normalize('NFKC').trim().toLocaleLowerCase('zh-Hant').replace(/[\s\p{P}\p{S}]+/gu, '');

export const splitLegacyRules = (text: string): string[] => text
  .replace(/\r\n?/g, '\n')
  .split(/\n+/)
  .map((line) => line.trim().replace(/^\s*(?:\d+[.、)]|[-*•])\s*/, ''))
  .filter(Boolean);

export const chooseFlowStage = (category: string): string => {
  const normalized = category.normalize('NFKC').trim();
  if (normalized === '起始設置') return 'setup';
  if (normalized === '回合設置') return 'round';
  if (normalized === '計分' || normalized === '結束方式') return 'end_scoring';
  return 'uncategorized';
};

const stageOverrides: Record<string, string[]> = {
  '2020-08-24T14:16:23.441Z': ['setup', 'setup', 'end_scoring', 'action'],
  '2020-08-24T22:43:25.453Z': ['round', 'end_scoring'],
  '2021-03-07T23:07:31.144Z': ['setup', 'action', 'action'],
  '2022-11-26T17:34:46.062Z': ['round'],
  '2024-07-28T00:05:19.032Z': ['end_scoring', 'action', 'end_scoring'],
  '2024-08-11T21:56:59.795Z': ['setup', 'setup'],
  '2024-08-18T22:22:56.088Z': ['setup', 'action', 'action', 'action'],
};

const reviewedSingleRuleTimestamps = new Set([
  '2020-09-01T23:43:15.586Z',
  '2021-01-25T23:23:04.263Z',
  '2021-04-01T23:49:00.543Z',
  '2023-01-15T11:51:06.778Z',
  '2024-11-23T23:38:19.302Z',
]);

export interface LegacyRuleDraft {
  statement: string;
  details?: string;
  flowStage: string;
}

export const isReviewedLegacySplit = (timestamp: string): boolean =>
  reviewedSingleRuleTimestamps.has(timestamp);

export const prepareLegacyRules = (record: LegacyRecord): LegacyRuleDraft[] => {
  const paragraphs = splitLegacyRules(record.ruleText);
  const reviewedAsSingleRule = isReviewedLegacySplit(record.timestamp);
  const statements = reviewedAsSingleRule ? paragraphs.slice(0, 1) : paragraphs;
  const details = reviewedAsSingleRule ? paragraphs.slice(1).join('\n') || undefined : undefined;
  const overrides = stageOverrides[record.timestamp];
  return statements.map((statement, index) => ({
    statement,
    details: index === 0 ? details : undefined,
    flowStage: overrides?.[index] ?? chooseFlowStage(record.category),
  }));
};

export const taipeiCalendarDate = (timestamp: string): string => {
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) throw new Error(`Invalid legacy timestamp: ${timestamp}`);
  // Taiwan has remained UTC+8 for the entire range represented by the workbook.
  return new Date(milliseconds + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
};

export const legacyRowKey = (timestamp: string): string => {
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) throw new Error(`Invalid legacy timestamp: ${timestamp}`);
  return new Date(milliseconds).toISOString();
};

export const canonicalLegacyGameName = (value: string): string =>
  normalizeLegacyName(value) === normalizeLegacyName('氣笛山脈') ? 'Whistle Mountain 汽笛山脈' : value.trim();

export const legacyGameAliases = (value: string): string[] => {
  const canonical = canonicalLegacyGameName(value);
  const aliases = new Set([value.trim(), canonical]);
  const english = canonical.match(/[A-Za-z][A-Za-z0-9:.'’&!\- ]*/g)?.join(' ').trim();
  const chinese = canonical.match(/[\p{Script=Han}][\p{Script=Han}\s·：！—-]*/gu)?.join(' ').trim();
  if (english) aliases.add(english);
  if (chinese) aliases.add(chinese);
  if (canonical === 'Whistle Mountain 汽笛山脈') aliases.add('氣笛山脈');
  return [...aliases].filter(Boolean);
};

export const allUrls = (value: string): string[] => [...new Set(value.match(/https?:\/\/[^\s]+/g) ?? [])];

export const parseDeclaredCount = (value: unknown): number | undefined => {
  const match = String(value ?? '').normalize('NFKC').match(/\d+/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};
export const stableLegacyId = (prefix: string, value: string) => `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 20)}`;

export const sqlValue = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined || value === '') return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  return `'${value.replaceAll("'", "''")}'`;
};
