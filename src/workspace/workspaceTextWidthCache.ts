import { displayWorkspaceColumnValue } from './model';
import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceRow } from './types';
import { measureWorkspaceText } from './workspaceShared';

interface WidthEntry {
  value: WorkspaceCellValue;
  format: string;
  body?: number;
  heading?: number;
}

/** Row identities survive single-cell edits; removed rows can be garbage collected. */
export const createWorkspaceTextWidthCache = (measureText = measureWorkspaceText) => {
  const rows = new WeakMap<WorkspaceRow, Map<string, WidthEntry>>();
  const formats = new WeakMap<WorkspaceColumn, string>();
  return {
    measure(row: WorkspaceRow, column: WorkspaceColumn, value: WorkspaceCellValue, fontWeight: 400 | 600 = 400) {
      let format = formats.get(column);
      if (format === undefined) {
        format = `${column.inputType}:${Boolean(column.isMultiple)}:${Boolean(column.dateOnly)}`;
        formats.set(column, format);
      }
      let widths = rows.get(row);
      if (!widths) {
        widths = new Map();
        rows.set(row, widths);
      }
      let entry = widths.get(column.id);
      if (!entry || entry.format !== format || !Object.is(entry.value, value)) {
        entry = { value, format };
        widths.set(column.id, entry);
      }
      const slot = fontWeight === 600 ? 'heading' : 'body';
      return entry[slot] ??= measureText(displayWorkspaceColumnValue(value, column), 20, fontWeight);
    },
  };
};
