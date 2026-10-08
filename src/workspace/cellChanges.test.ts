import { describe, expect, it } from 'vitest';
import { applyWorkspaceCellChanges, removeWorkspaceColumnValues } from './cellChanges';
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
});
