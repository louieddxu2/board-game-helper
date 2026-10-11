import { describe, expect, it } from 'vitest';
import { applyWorkspaceCellChanges } from './cellChanges';
import { getWorkspaceRow, getWorkspaceRowIndexes } from './rowIndexes';
import type { WorkspaceRow } from './types';

const rows = (count: number): WorkspaceRow[] => Array.from({ length: count }, (_, index) => ({
  id: `row-${index}`, name: `項目 ${index}`, values: { value: null },
}));

describe('workspace row indexes', () => {
  it('keys indexes by the exact immutable array and uses array-local positions for flattened windows', () => {
    const source = rows(4);
    const sourceIndexes = getWorkspaceRowIndexes(source);
    expect(getWorkspaceRowIndexes(source)).toBe(sourceIndexes);
    expect([...sourceIndexes.entries()]).toEqual([['row-0', 0], ['row-1', 1], ['row-2', 2], ['row-3', 3]]);

    const reordered = [source[2], source[0], source[3], source[1]];
    const added = [...source, { id: 'row-new', name: '新增', values: {} }];
    const removed = source.slice(1);
    expect(getWorkspaceRowIndexes(reordered)).not.toBe(sourceIndexes);
    expect(getWorkspaceRowIndexes(added)).not.toBe(sourceIndexes);
    expect(getWorkspaceRowIndexes(removed)).not.toBe(sourceIndexes);
    expect([...getWorkspaceRowIndexes(reordered).entries()]).toEqual([['row-2', 0], ['row-0', 1], ['row-3', 2], ['row-1', 3]]);
    expect(getWorkspaceRowIndexes(added).get('row-new')).toBe(4);
    expect(getWorkspaceRowIndexes(removed).get('row-1')).toBe(0);

    const flattened = [source[3], source[1]];
    expect(getWorkspaceRow(flattened, 'row-3')).toBe(source[3]);
    expect(getWorkspaceRow(flattened, 'row-1')).toBe(source[1]);
    expect(getWorkspaceRowIndexes(flattened).get('row-3')).toBe(0);
    expect(getWorkspaceRowIndexes(flattened).get('row-1')).toBe(1);
    expect(getWorkspaceRow(flattened, 'row-0')).toBeUndefined();
  });

  it('keeps warmed indexes and offscreen row references through one value edit, undo, and redo', () => {
    const reads: string[] = [];
    const trackedRows = Array.from({ length: 10_000 }, (_, index) => {
      const id = `row-${index}`;
      const row = { name: `項目 ${index}`, values: { value: null } } as unknown as WorkspaceRow;
      Object.defineProperty(row, 'id', { configurable: true, enumerable: true, get: () => { reads.push(id); return id; } });
      return row;
    });
    const indexes = getWorkspaceRowIndexes(trackedRows);
    expect(reads).toHaveLength(10_000);
    reads.length = 0;

    const edit = { rowId: 'row-10', columnId: 'value', before: null, after: 'edited' as const };
    const edited = applyWorkspaceCellChanges(trackedRows, undefined, [edit]);
    expect(getWorkspaceRowIndexes(edited)).toBe(indexes);
    expect(edited[0]).toBe(trackedRows[0]);
    expect(edited[9_999]).toBe(trackedRows[9_999]);
    expect(edited[10].values.value).toBe('edited');

    const undone = applyWorkspaceCellChanges(edited, undefined, [edit], 'before');
    const redone = applyWorkspaceCellChanges(undone, undefined, [edit]);
    expect(getWorkspaceRowIndexes(undone)).toBe(indexes);
    expect(getWorkspaceRowIndexes(redone)).toBe(indexes);
    expect(undone[0]).toBe(edited[0]);
    expect(redone[0]).toBe(undone[0]);
    expect(undone[10].values.value).toBeNull();
    expect(redone[10].values.value).toBe('edited');
    expect(reads.filter(id => id !== 'row-10')).toEqual([]);
    expect(reads.length).toBeLessThan(10);
  });
});
