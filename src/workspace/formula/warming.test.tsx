import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createTable, createColumn } from '../model';
import type { WorkspaceTable } from '../types';
import * as evaluation from './evaluation';
import { useWorkspaceComputedValues } from './useWorkspaceComputedValues';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('warms after paint, reuses results across formatting changes, and does not rescan when one source changes', () => {
  const callbacks = new Map<number, IdleRequestCallback>();
  let sequence = 0;
  vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => { callbacks.set(++sequence, callback); return sequence; });
  vi.stubGlobal('cancelIdleCallback', (id: number) => callbacks.delete(id));
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const evaluate = vi.spyOn(evaluation, 'evaluateWorkspaceFormula');
  const computed = { ...createColumn('雙倍', 'number'), id: 'computed', formula: { version: 1 as const, expression: 'price * 2', variables: { price: { columnId: 'price' } } } };
  const table: WorkspaceTable = { ...createTable('暖快取'), columns: [{ ...createColumn('價格', 'number'), id: 'price' }, computed], rows: Array.from({ length: 100 }, (_, index) => ({ id: `row-${index}`, name: '項目', values: { price: index } })) };
  const { result, rerender, unmount } = renderHook(({ current }) => useWorkspaceComputedValues(current), { initialProps: { current: table } });
  expect(evaluate).not.toHaveBeenCalled();
  act(() => {
    for (let batch = 0; callbacks.size && batch < 20; batch++) {
      const pending = [...callbacks.values()]; callbacks.clear();
      pending.forEach(callback => callback({ didTimeout: false, timeRemaining: () => 20 }));
    }
  });
  expect(evaluate).toHaveBeenCalledTimes(100);
  expect(result.current(table.rows[0], computed).value).toBe(0);
  const changed = { ...table, rows: table.rows.map((row, index) => index === 0 ? { ...row, values: { price: 300 } } : row) };
  rerender({ current: changed });
  expect(callbacks.size).toBe(0);
  expect(result.current(changed.rows[0], computed).value).toBe(600);
  expect(evaluate).toHaveBeenCalledTimes(101);
  const formatted = { ...changed, columns: changed.columns.map(column => ({ ...column, name: `${column.name}改名`, alignment: 'right' as const })) };
  rerender({ current: formatted });
  expect(callbacks.size).toBe(0);
  expect(result.current(formatted.rows[0], formatted.columns[1]).value).toBe(600);
  expect(evaluate).toHaveBeenCalledTimes(101);
  rerender({ current: { ...formatted, id: 'other-table' } });
  expect(callbacks.size).toBeGreaterThan(0);
  unmount();
  expect(callbacks.size).toBe(0);
});
