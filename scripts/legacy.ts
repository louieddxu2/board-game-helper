import { createHash } from 'node:crypto';

export interface LegacyRecord {
  rowNumber: number;
  timestamp: string;
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
  if (/起始|設置/.test(category)) return 'setup';
  if (/計分|結束/.test(category)) return 'end_scoring';
  if (/回合/.test(category)) return 'round';
  if (/不對稱|版本|擴充|人數/.test(category)) return 'edition_player_count';
  return 'uncategorized';
};

export const firstUrl = (value: string): string | undefined => value.match(/https?:\/\/[^\s]+/)?.[0];
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
