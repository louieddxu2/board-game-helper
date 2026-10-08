import { describe, expect, it } from 'vitest';
import { createColumn, createTable } from './model';
import {
  createWorkspaceTableStorageSnapshot,
  type StoredWorkspaceRowChunk,
  type StoredWorkspaceTable,
  type StoredWorkspaceTableState,
} from './rowChunkStorage';
import type { StoredWorkspaceRowOrderPage } from './rowOrderStorage';
import { hydrateWorkspaceTable, workspaceHydrationBatchSize } from './workspaceTableHydration';
import type { WorkspaceTable } from './types';

const makeFixture = (count: number, dynamic = false) => {
  const table = createTable('hydration');
  const column = createColumn(dynamic ? '標籤' : '值', dynamic ? 'dynamic-select' : 'text');
  table.columns = [column];
  table.rows = Array.from({ length: count }, (_, index) => ({
    id: `row-${index}`,
    name: `項目 ${index}`,
    values: { [column.id]: dynamic ? (index < count * 0.7 ? 'Common' : 'Rare') : `value-${index}` },
  }));
  const snapshot = createWorkspaceTableStorageSnapshot(table);
  const state: StoredWorkspaceTableState = { updatedAt: table.updatedAt, changeRevision: table.changeRevision };
  return {
    table,
    record: snapshot.record,
    chunks: [...snapshot.chunks.values()],
    orderPages: [...snapshot.order.pages.values()],
    state,
  };
};

const makeReader = (chunks: StoredWorkspaceRowChunk[], orderPages: StoredWorkspaceRowOrderPage[]) => {
  const chunkCalls: string[][] = [];
  const orderCalls: string[][] = [];
  return {
    chunkCalls,
    orderCalls,
    reader: {
      chunks: async (ids: readonly string[]) => {
        chunkCalls.push([...ids]);
        return ids.flatMap(id => chunks.filter(chunk => chunk.chunkId === id));
      },
      order: async (ids: readonly string[]) => {
        orderCalls.push([...ids]);
        return ids.flatMap(id => orderPages.filter(page => page.pageId === id));
      },
    },
  };
};

const checkCurrent = () => undefined;

describe('workspace table hydration', () => {
  it('hydrates 10,000 rows in bounded manifest reads while preserving content and dynamic statistics', async () => {
    const fixture = makeFixture(10_000, true);
    const { reader, chunkCalls, orderCalls } = makeReader(fixture.chunks, fixture.orderPages);
    const result = await hydrateWorkspaceTable(fixture.table.id, fixture.record, fixture.state, reader, checkCurrent);

    expect(chunkCalls.length).toBeGreaterThan(1);
    expect(orderCalls.length).toBeGreaterThan(1);
    expect([...chunkCalls, ...orderCalls].every(batch => batch.length <= workspaceHydrationBatchSize)).toBe(true);
    expect(result.table.rows).toHaveLength(10_000);
    expect(result.table.rows[0].values[fixture.table.columns[0].id]).toBe('Common');
    expect(result.table.rows.at(-1)?.values[fixture.table.columns[0].id]).toBe('Rare');
    expect(result.snapshot).toBeDefined();
    if (!result.snapshot) throw new Error('Expected hydration snapshot');
    expect(result.snapshot.rowIndexes.get('row-9999')).toBe(9_999);
    expect(result.snapshot.table.rows.map(row => row.id)).toEqual(fixture.table.rows.map(row => row.id));

    const counts = result.table.columns[0].dynamicOptions?.counts ?? [];
    expect(Object.fromEntries(counts.map(item => [item.key, item.count]))).toEqual({ common: 7_000, rare: 3_000 });
  });

  it('defers the snapshot and dynamic statistics until a non-deferred pass', async () => {
    const fixture = makeFixture(128, true);
    const { reader } = makeReader(fixture.chunks, fixture.orderPages);
    const deferred = await hydrateWorkspaceTable(fixture.table.id, fixture.record, fixture.state, reader, checkCurrent, true);

    expect(deferred.snapshot).toBeUndefined();
    expect(deferred.table.columns[0].dynamicOptions).toBeUndefined();
    expect(deferred.table.rows).toHaveLength(128);

    const complete = await hydrateWorkspaceTable(fixture.table.id, fixture.record, fixture.state, reader, checkCurrent);
    expect(complete.snapshot).toBeDefined();
    expect(complete.table.columns[0].dynamicOptions?.counts.map(item => [item.key, item.count])).toEqual([
      ['common', 90], ['rare', 38],
    ]);
  });

  it('reads legacy row-chunks-v1 order from its embedded vector and v2 order pages from exact IDs', async () => {
    const fixture = makeFixture(600);
    const legacy: StoredWorkspaceTable = {
      ...fixture.record,
      storageFormat: 'row-chunks-v1',
      rowOrder: [...fixture.table.rows].reverse().map(row => row.id),
    };
    const legacyReader = makeReader(fixture.chunks, fixture.orderPages);
    const legacyResult = await hydrateWorkspaceTable(fixture.table.id, legacy, fixture.state, legacyReader.reader, checkCurrent);
    expect(legacyReader.orderCalls).toEqual([]);
    expect(legacyResult.table.rows[0].id).toBe('row-599');
    expect(legacyResult.table.rows.at(-1)?.id).toBe('row-0');

    const v2Reader = makeReader(fixture.chunks, fixture.orderPages);
    const v2Result = await hydrateWorkspaceTable(fixture.table.id, fixture.record, fixture.state, v2Reader.reader, checkCurrent);
    expect(v2Reader.orderCalls.length).toBeGreaterThan(0);
    expect(v2Result.table.rows.map(row => row.id)).toEqual(fixture.table.rows.map(row => row.id));
  });

  it.each(['missing chunk', 'duplicate row', 'missing order page'] as const)('does not publish a partial table for a late %s integrity failure', async failure => {
    const fixture = makeFixture(600);
    let chunks = fixture.chunks;
    let orderPages = fixture.orderPages;
    if (failure === 'missing chunk') chunks = fixture.chunks.slice(0, -1);
    if (failure === 'duplicate row') chunks = fixture.chunks.map((chunk, index) => index === 1 ? { ...chunk, rows: [{ ...chunk.rows[0], id: fixture.chunks[0].rows[0].id }, ...chunk.rows.slice(1)] } : chunk);
    if (failure === 'missing order page') orderPages = fixture.orderPages.slice(0, -1);
    const { reader } = makeReader(chunks, orderPages);
    let published = false;
    const pending = hydrateWorkspaceTable(fixture.table.id, fixture.record, fixture.state, reader, checkCurrent).then(() => { published = true; });

    await expect(pending).rejects.toThrow();
    expect(published).toBe(false);
  });

  it('stops before the next canonical batch when the owner is no longer current', async () => {
    const fixture = makeFixture(600);
    let current = true;
    const { reader, chunkCalls, orderCalls } = makeReader(fixture.chunks, fixture.orderPages);
    const pending = hydrateWorkspaceTable(fixture.table.id, fixture.record, fixture.state, {
      chunks: async ids => { const result = await reader.chunks(ids); current = false; return result; },
      order: reader.order,
    }, () => { if (!current) throw new DOMException('cancelled', 'AbortError'); });

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(chunkCalls).toHaveLength(1);
    expect(chunkCalls[0]).toHaveLength(workspaceHydrationBatchSize);
    expect(orderCalls).toEqual([]);
  });

  it('completes through task yields even when idle callbacks are withheld', async () => {
    const fixture = makeFixture(300);
    const { reader } = makeReader(fixture.chunks, fixture.orderPages);
    const original = globalThis.requestIdleCallback;
    Object.assign(globalThis, { requestIdleCallback: undefined });
    try {
      const result = await hydrateWorkspaceTable(fixture.table.id, fixture.record, fixture.state, reader, checkCurrent);
      expect(result.table.rows).toHaveLength(300);
      expect(result.snapshot).toBeDefined();
      if (!result.snapshot) throw new Error('Expected hydration snapshot');
      expect(result.snapshot.rowIndexes.get('row-299')).toBe(299);
    } finally {
      Object.assign(globalThis, { requestIdleCallback: original });
    }
  });
});
