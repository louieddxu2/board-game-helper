import { describe, expect, it } from 'vitest';
import { createWorkspaceTextWidthCache } from './workspaceTextWidthCache';
import type { WorkspaceColumn, WorkspaceRow } from './types';

const column = (overrides: Partial<WorkspaceColumn> = {}): WorkspaceColumn => ({
  id: 'column-1',
  name: '欄位',
  inputType: 'text',
  options: [],
  ...overrides,
});

const row = (value: string): WorkspaceRow => ({ id: 'row-1', name: '物件', values: { 'column-1': value } });

describe('workspace text width cache', () => {
  it('reuses an unchanged row value while measuring changed immutable rows exactly once', () => {
    const calls: Array<{ text: string; fontWeight: number }> = [];
    const cache = createWorkspaceTextWidthCache((text, _minimumWidth, fontWeight) => {
      calls.push({ text, fontWeight });
      return text.length * 10 + fontWeight;
    });
    const first = row('短');
    const edited = { ...first, values: { ...first.values, 'column-1': '長內容' } };
    const textColumn = column();

    expect(cache.measure(first, textColumn, '短')).toBe(410);
    expect(cache.measure(first, textColumn, '短')).toBe(410);
    expect(cache.measure(edited, textColumn, '長內容')).toBe(430);
    expect(cache.measure(edited, textColumn, '長內容')).toBe(430);
    expect(calls).toEqual([
      { text: '短', fontWeight: 400 },
      { text: '長內容', fontWeight: 400 },
    ]);
  });

  it('keeps body and heading widths separate and invalidates when the display format changes', () => {
    const calls: string[] = [];
    const cache = createWorkspaceTextWidthCache((text, _minimumWidth, fontWeight) => {
      calls.push(`${fontWeight}:${text}`);
      return text.length * 10;
    });
    const valueRow = row('alpha, beta');
    const plain = column();

    expect(cache.measure(valueRow, plain, 'alpha, beta')).toBe(110);
    expect(cache.measure(valueRow, plain, 'alpha, beta', 600)).toBe(110);
    expect(cache.measure(valueRow, plain, 'alpha, beta')).toBe(110);

    const multiple = column({ isMultiple: true });
    expect(cache.measure(valueRow, multiple, 'alpha, beta')).toBe(100);
    expect(cache.measure(valueRow, multiple, 'alpha, beta')).toBe(100);

    const date = column({ inputType: 'datetime', dateOnly: true });
    const dateValue = '2026-08-12T12:14:00.000Z';
    expect(cache.measure(valueRow, date, dateValue)).toBe(100);
    expect(cache.measure(valueRow, date, dateValue)).toBe(100);

    expect(calls).toEqual([
      '400:alpha, beta',
      '600:alpha, beta',
      '400:alpha、beta',
      '400:2026/08/12',
    ]);
  });

  it('does not confuse two row objects that share an id and value', () => {
    let calls = 0;
    const cache = createWorkspaceTextWidthCache(() => { calls += 1; return 80; });
    const first = row('same');
    const second = { ...first, values: { ...first.values } };

    expect(cache.measure(first, column(), 'same')).toBe(80);
    expect(cache.measure(second, column(), 'same')).toBe(80);
    expect(calls).toBe(2);
  });

  it('returns exact growth and shrink results from the injected measurement', () => {
    const measured = new Map([['small', 40], ['large', 180]]);
    const cache = createWorkspaceTextWidthCache((text) => measured.get(text) ?? 0);
    const valueRow = row('small');
    const textColumn = column();

    expect(cache.measure(valueRow, textColumn, 'small')).toBe(40);
    expect(cache.measure(valueRow, textColumn, 'large')).toBe(180);
    expect(cache.measure(valueRow, textColumn, 'small')).toBe(40);
  });
});
