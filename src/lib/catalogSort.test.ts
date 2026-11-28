import { expect, test } from 'vitest';
import type { CatalogRow } from './catalogSort';
import { nextCatalogSort, parseCatalogSort, sortCatalogRows } from './catalogSort';

const row = (displayName: string, values: Partial<Omit<CatalogRow, 'game'>> & { englishName?: string } = {}): CatalogRow => ({
  game: { id: displayName, slug: displayName, displayName, englishName: values.englishName, ruleCount: values.ruleCount ?? 0, updatedAt: 1 },
  ruleCount: values.ruleCount ?? 0, uncertainCount: values.uncertainCount ?? 0, uncheckedCount: 0, updatedAt: values.updatedAt ?? 1,
});
const names = (rows: CatalogRow[]) => rows.map((entry) => entry.game.displayName);
const rows = [
  row('Bravo', { ruleCount: 3, uncertainCount: 0, updatedAt: 20, englishName: 'bravo' }),
  row('Alpha', { ruleCount: 3, uncertainCount: 2, updatedAt: 10 }),
  row('Charlie', { ruleCount: 7, uncertainCount: 1, updatedAt: 30, englishName: 'Able' }),
];

test('without a sort the rows keep their order', () => {
  expect(names(sortCatalogRows(rows, undefined))).toEqual(['Bravo', 'Alpha', 'Charlie']);
  expect(parseCatalogSort('nonsense', 'asc')).toBeUndefined();
});

test('counts and dates sort largest first, with ties by name', () => {
  expect(names(sortCatalogRows(rows, { key: 'rules', direction: 'desc' }))).toEqual(['Charlie', 'Alpha', 'Bravo']);
  expect(names(sortCatalogRows(rows, { key: 'uncertain', direction: 'desc' }))).toEqual(['Alpha', 'Charlie', 'Bravo']);
  expect(names(sortCatalogRows(rows, { key: 'updated', direction: 'asc' }))).toEqual(['Alpha', 'Bravo', 'Charlie']);
});

test('games without an English name stay last in either direction', () => {
  expect(names(sortCatalogRows(rows, { key: 'english', direction: 'asc' }))).toEqual(['Charlie', 'Bravo', 'Alpha']);
  expect(names(sortCatalogRows(rows, { key: 'english', direction: 'desc' }))).toEqual(['Bravo', 'Charlie', 'Alpha']);
});

test('a column first sorts its natural way, and clicking it again reverses', () => {
  expect(parseCatalogSort('rules', null)).toEqual({ key: 'rules', direction: 'desc' });
  expect(nextCatalogSort(undefined, 'name')).toEqual({ key: 'name', direction: 'asc' });
  expect(nextCatalogSort({ key: 'name', direction: 'asc' }, 'name')).toEqual({ key: 'name', direction: 'desc' });
  expect(nextCatalogSort({ key: 'name', direction: 'asc' }, 'updated')).toEqual({ key: 'updated', direction: 'desc' });
});
