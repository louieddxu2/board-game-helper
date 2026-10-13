import { getWorkspaceEffectiveCell, type WorkspaceCellReader } from './formula/values';
import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceRow } from './types';
import { measureWorkspaceText } from './workspaceShared';
import { createWorkspaceTextWidthCache } from './workspaceTextWidthCache';

/** Only the rows actually mounted by the owner contribute to column width. */
export const measureVisibleColumnWidths = (
  rows: readonly WorkspaceRow[], rowHeader: WorkspaceColumn, columns: readonly WorkspaceColumn[],
  cache: ReturnType<typeof createWorkspaceTextWidthCache>, measureHeader = measureWorkspaceText, readCell: WorkspaceCellReader = getWorkspaceEffectiveCell,
) => [rowHeader, ...columns].map(column => {
  let width = 0;
  if (column.overflowMode === 'expand' || column.widthLimitChars) {
    for (const row of rows) {
      const value: WorkspaceCellValue = readCell(row, column, column.id === rowHeader.id).value;
      width = Math.max(width, cache.measure(row, column, value));
    }
  }
  if (column.overflowMode !== 'expand') width = column.widthLimitChars ? Math.min(width, column.widthLimitChars * 20) : 0;
  return Math.max(measureHeader(column.name, 20, 600), width)
    + (column.inputType === 'link' && column.overflowMode === 'expand' ? 46 : 0);
});

/** Keep the first exposed data column beside the sticky row header when widths change. */
export const preserveColumnScrollPosition = (before: readonly number[], after: readonly number[], scrollLeft: number) => {
  if (scrollLeft <= 0 || before.length !== after.length) return Math.max(0, scrollLeft);
  const position = scrollLeft + (before[0] ?? 0);
  let start = before[0] ?? 0;
  let index = 1;
  while (index < before.length - 1 && start + before[index] <= position) start += before[index++];
  const nextStart = after.slice(0, index).reduce((sum, width) => sum + width, 0);
  return Math.max(0, nextStart + Math.min(Math.max(0, position - start), Math.max(0, (after[index] ?? 0) - 1)) - (after[0] ?? 0));
};
