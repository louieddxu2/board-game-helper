import { describe, expect, it } from 'vitest';
import { createWorkspaceTextWidthCache } from './workspaceTextWidthCache';
import { measureVisibleColumnWidths, preserveColumnScrollPosition } from './visibleColumnWidths';
import type { WorkspaceColumn, WorkspaceRow } from './types';

const header: WorkspaceColumn = { id: 'name', name: 'Name', inputType: 'text', options: [], overflowMode: 'expand' };
const column: WorkspaceColumn = { ...header, id: 'value', name: 'Value' };
const row = (id: string, value: string): WorkspaceRow => ({ id, name: 'x', values: { value } });
const measure = (text: string) => text.length * 10;

describe('rendered column widths', () => {
  it('grows and shrinks with the rendered set, including buffered rows', () => {
    const cache = createWorkspaceTextWidthCache(measure);
    const short = row('short', 'short');
    const buffered = row('buffer', 'a much longer value');
    expect(measureVisibleColumnWidths([short], header, [column], cache, measure)).toEqual([40, 50]);
    expect(measureVisibleColumnWidths([short, buffered], header, [column], cache, measure)).toEqual([40, 190]);
    expect(measureVisibleColumnWidths([short], header, [column], cache, measure)).toEqual([40, 50]);
  });

  it('does not read values for unlimited wrap columns and keeps header/width limits', () => {
    const forbidden = { id: 'row', name: 'x', get values(): Record<string, string> { throw new Error('unneeded body measurement'); } };
    const cache = createWorkspaceTextWidthCache(measure);
    expect(measureVisibleColumnWidths([forbidden], header, [{ ...column, overflowMode: 'wrap' }], cache, measure)).toEqual([40, 50]);
    expect(measureVisibleColumnWidths([row('long', 'x'.repeat(100))], header, [{ ...column, overflowMode: 'wrap', widthLimitChars: 4 }], cache, measure)).toEqual([40, 80]);
  });

  it('preserves a horizontally exposed column rather than an obsolete pixel position', () => {
    expect(preserveColumnScrollPosition([80, 100, 300, 100], [120, 60, 100, 100], 150)).toBe(110);
    expect(preserveColumnScrollPosition([80, 100, 300], [120, 60, 100], 0)).toBe(0);
    expect(preserveColumnScrollPosition([80, 100, 300], [120, 60, 30], 350)).toBe(89);
  });
});
