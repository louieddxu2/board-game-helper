import type { GameSummary } from '../shared/types';

export type CatalogSortKey = 'name' | 'english' | 'rules' | 'uncertain' | 'updated';
export type CatalogSortDirection = 'asc' | 'desc';
export interface CatalogSort { key: CatalogSortKey; direction: CatalogSortDirection }

/** One row of the game list: the game, its counts and the date the list shows. */
export interface CatalogRow {
  game: GameSummary;
  ruleCount: number;
  uncertainCount: number;
  uncheckedCount: number;
  updatedAt: number;
}

export const CATALOG_SORT_KEYS: CatalogSortKey[] = ['name', 'english', 'rules', 'uncertain', 'updated'];
/** A column's first click: names A→Z, counts and dates largest or newest first. */
export const FIRST_DIRECTION: Record<CatalogSortKey, CatalogSortDirection> = { name: 'asc', english: 'asc', rules: 'desc', uncertain: 'desc', updated: 'desc' };

export const parseCatalogSort = (key: string | null, direction: string | null): CatalogSort | undefined => {
  if (!CATALOG_SORT_KEYS.includes(key as CatalogSortKey)) return undefined;
  const sortKey = key as CatalogSortKey;
  return { key: sortKey, direction: direction === 'asc' || direction === 'desc' ? direction : FIRST_DIRECTION[sortKey] };
};

/** Clicking a column sorts by it; clicking the sorted column again reverses it. */
export const nextCatalogSort = (current: CatalogSort | undefined, key: CatalogSortKey): CatalogSort =>
  current?.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: FIRST_DIRECTION[key] };

const byName = (left: CatalogRow, right: CatalogRow) => left.game.displayName.localeCompare(right.game.displayName, 'zh-Hant');

/** Without a sort the rows keep their order. Games without an English name stay last either way; ties fall back to the name. */
export const sortCatalogRows = (rows: CatalogRow[], sort: CatalogSort | undefined): CatalogRow[] => {
  if (!sort) return rows;
  const sign = sort.direction === 'asc' ? 1 : -1;
  const compare = (left: CatalogRow, right: CatalogRow): number => {
    switch (sort.key) {
      case 'name': return sign * byName(left, right);
      case 'english': {
        const a = left.game.englishName?.trim();
        const b = right.game.englishName?.trim();
        if (!a || !b) return a ? -1 : b ? 1 : byName(left, right);
        return sign * a.localeCompare(b, 'en', { sensitivity: 'base' }) || byName(left, right);
      }
      case 'rules': return sign * (left.ruleCount - right.ruleCount) || byName(left, right);
      case 'uncertain': return sign * (left.uncertainCount - right.uncertainCount) || byName(left, right);
      case 'updated': return sign * (left.updatedAt - right.updatedAt) || byName(left, right);
    }
  };
  return [...rows].sort(compare);
};

export const CATALOG_SORT_LABELS: Record<CatalogSortKey, string> = { name: '遊戲', english: '英文名稱', rules: '規則數', uncertain: '不確定', updated: '最後更新' };
const DIRECTION_LABELS: Record<CatalogSortKey, Record<CatalogSortDirection, string>> = {
  name: { asc: '筆畫少→多', desc: '筆畫多→少' },
  english: { asc: 'A→Z', desc: 'Z→A' },
  rules: { desc: '多→少', asc: '少→多' },
  uncertain: { desc: '多→少', asc: '少→多' },
  updated: { desc: '新→舊', asc: '舊→新' },
};
export const catalogSortOptionLabel = (sort: CatalogSort) => `${CATALOG_SORT_LABELS[sort.key]}（${DIRECTION_LABELS[sort.key][sort.direction]}）`;
