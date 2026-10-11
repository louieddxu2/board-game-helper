import { describe, expect, it } from 'vitest';
import { applyWorkspaceCellChanges, captureWorkspaceColumnValues, removeWorkspaceColumnValues, restoreWorkspaceColumnValues } from './cellChanges';
import type { WorkspaceRow } from './types';

const headerId = 'row-header';
const valueId = 'value';
const linkId = 'link';
const link = { url: 'https://example.com', label: '官網' };

const rows: WorkspaceRow[] = [
  { id: 'row-1', name: '第一筆', values: { [valueId]: '舊值', [linkId]: link } },
  { id: 'row-2', name: '第二筆', values: { [valueId]: '保留' } },
  { id: 'row-3', name: '第三筆', values: { [linkId]: link } },
];

describe('workspace cell changes', () => {
  it('applies mixed changes immutably while retaining name-only values and semantic link no-ops', () => {
    const next = applyWorkspaceCellChanges(rows, headerId, [
      { rowId: 'row-1', columnId: headerId, before: '第一筆', after: '改名' },
      { rowId: 'row-1', columnId: valueId, before: '舊值', after: '新值' },
      { rowId: 'row-1', columnId: linkId, before: link, after: { label: '官網', url: link.url } },
      { rowId: 'row-2', columnId: headerId, before: '第二筆', after: '只改名稱' },
      { rowId: 'row-3', columnId: linkId, before: link, after: { url: link.url, label: link.label } },
    ]);

    expect(next).not.toBe(rows);
    expect(next[0]).not.toBe(rows[0]);
    expect(next[0]).toMatchObject({ name: '改名', values: { [valueId]: '新值', [linkId]: link } });
    expect(next[0].values).not.toBe(rows[0].values);
    expect(rows[0].name).toBe('第一筆');
    expect(rows[0].values[valueId]).toBe('舊值');
    expect(next[1]).not.toBe(rows[1]);
    expect(next[1].name).toBe('只改名稱');
    expect(next[1].values).toBe(rows[1].values);
    expect(next[2]).toBe(rows[2]);
  });

  it('returns the original rows when every requested change is semantically unchanged', () => {
    const next = applyWorkspaceCellChanges(rows, headerId, [{
      rowId: 'row-3', columnId: linkId, before: link, after: { label: link.label, url: link.url },
    }]);

    expect(next).toBe(rows);
  });

  it('removes only owned sparse column keys and preserves absent rows and other values', () => {
    const sparseRows: WorkspaceRow[] = [
      { id: 'row-1', name: '第一筆', values: { [valueId]: '保留', [linkId]: null } },
      { id: 'row-2', name: '第二筆', values: { [valueId]: '沒有此欄' } },
      { id: 'row-3', name: '第三筆', values: { [valueId]: '保留', [linkId]: link } },
    ];
    const next = removeWorkspaceColumnValues(sparseRows, new Set([linkId]));

    expect(next).not.toBe(sparseRows);
    expect(next[0]).not.toBe(sparseRows[0]);
    expect(next[0].values).toEqual({ [valueId]: '保留' });
    expect(next[1]).toBe(sparseRows[1]);
    expect(next[2]).not.toBe(sparseRows[2]);
    expect(next[2].values).toEqual({ [valueId]: '保留' });
    expect(sparseRows[0].values[linkId]).toBeNull();
    expect(sparseRows[2].values[linkId]).toEqual(link);
  });

  it('captures stored values while omitting null and safely handles empty, zero, links, and a __proto__ row id', () => {
    const sparseRows: WorkspaceRow[] = [
      { id: 'missing', name: '缺少', values: { [linkId]: '其他' } },
      { id: 'null', name: '空值', values: { [valueId]: null } },
      { id: 'empty', name: '空字串', values: { [valueId]: '' } },
      { id: 'zero', name: '零', values: { [valueId]: 0 } },
      { id: 'link', name: '連結', values: { [valueId]: link } },
      { id: '__proto__', name: '特殊', values: { [valueId]: '特殊值' } },
    ];
    const captured = captureWorkspaceColumnValues(sparseRows, valueId);

    expect(Object.keys(captured)).toEqual(['empty', 'zero', 'link', '__proto__']);
    expect(Object.hasOwn(captured, 'missing')).toBe(false);
    expect(Object.hasOwn(captured, '__proto__')).toBe(true);
    expect(Object.hasOwn(captured, 'null')).toBe(false);
    expect(captured.empty).toBe('');
    expect(captured.zero).toBe(0);
    expect(captured.link).toEqual(link);
    expect(captured['__proto__']).toBe('特殊值');

    const removed = removeWorkspaceColumnValues(sparseRows, new Set([valueId]));
    const restored = restoreWorkspaceColumnValues(removed, valueId, captured);
    expect(Object.hasOwn(restored[0].values, valueId)).toBe(false);
    expect(Object.hasOwn(restored[1].values, valueId)).toBe(false);
    expect(restored.slice(2).map(row => row.values[valueId])).toEqual(['', 0, link, '特殊值']);
    expect(restored[5].id).toBe('__proto__');

    const legacyDense = restoreWorkspaceColumnValues(removed, valueId, { null: null, ...captured });
    expect(Object.hasOwn(legacyDense[1].values, valueId)).toBe(true);
    expect(legacyDense[1].values[valueId]).toBeNull();

    expect(restoreWorkspaceColumnValues(removed, valueId, {})).toBe(removed);
  });
});
