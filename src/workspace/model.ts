import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceData, WorkspaceDynamicOptions, WorkspaceInputType, WorkspaceLinkValue, WorkspaceNode, WorkspaceNumberInputMode, WorkspaceNumberRange, WorkspaceOverflowMode, WorkspaceRow, WorkspaceTable } from './types';
import { workspaceTableChangeRevision } from './changeRevisions';

const DEFAULT_ROW_HEADER_NAME = '項目';
export const MAX_BOTTOM_NAVIGATION_TABLES = 5;

export const makeId = (prefix: string) => {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
};

export const emptyWorkspace = (): WorkspaceData => ({ version: 1, nodes: [], tables: [], activeNodeId: null, bottomNavigationTableIds: [] });

export const createColumn = (name: string, inputType: WorkspaceInputType = 'text'): WorkspaceColumn => ({
  id: makeId('column'), name: name.trim(), inputType, options: [], alignment: 'left', overflowMode: inputType === 'link' ? 'ellipsis' : 'wrap',
});

export const createRow = (columns: WorkspaceColumn[], name = '項目 1'): WorkspaceRow => ({
  id: makeId('row'), name, values: Object.fromEntries(columns.map((column) => [column.id, null])),
});

export const createTable = (name: string): WorkspaceTable => {
  const columns = [createColumn('屬性 1', 'text')];
  const tableId = makeId('table');
  const rowHeader = { ...createColumn(DEFAULT_ROW_HEADER_NAME, 'text'), id: `row-header-${tableId}`, overflowMode: 'expand' as const };
  return { id: tableId, name: name.trim() || '未命名表格', rowHeaderName: DEFAULT_ROW_HEADER_NAME, rowHeader, textScale: 1, columns, rows: [createRow(columns)], updatedAt: Date.now() };
};

const normalizeOverflowMode = (value: WorkspaceOverflowMode | undefined, inputType: WorkspaceInputType, fallback: WorkspaceOverflowMode = 'wrap'): WorkspaceOverflowMode => value === 'expand' || value === 'ellipsis' || value === 'wrap' ? value : inputType === 'link' ? 'ellipsis' : fallback;
const normalizeWidthLimitChars = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value)) : undefined;
const normalizeLineLimit = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value)) : undefined;
const normalizeNumberInputMode = (value: unknown): WorkspaceNumberInputMode | undefined => value === 'input' || value === 'adjust' || value === 'step' ? value : undefined;

export const isWorkspaceColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const normalizeOptionColors = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const colors = Object.fromEntries(Object.entries(value).filter(([, color]) => isWorkspaceColor(color)));
  return Object.keys(colors).length ? colors : undefined;
};
const normalizeNumberRanges = (value: unknown): WorkspaceNumberRange[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((range) => {
    if (!range || typeof range !== 'object') return [];
    const candidate = range as Partial<WorkspaceNumberRange>;
    const min = candidate.min === null || candidate.min === undefined ? null : Number(candidate.min);
    const max = candidate.max === null || candidate.max === undefined ? null : Number(candidate.max);
    if ((min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max)) || (min !== null && max !== null && min > max) || !isWorkspaceColor(candidate.color)) return [];
    return [{ min, max, color: candidate.color }];
  });
};

const normalizeColumn = (column: WorkspaceColumn, fallbackOverflow: WorkspaceOverflowMode = 'wrap'): WorkspaceColumn => ({
  ...column,
  inputType: column.inputType === 'link' || column.inputType === 'datetime' || column.inputType === 'number' || column.inputType === 'select' || column.inputType === 'dynamic-select' ? column.inputType : 'text',
  numberInputMode: normalizeNumberInputMode(column.numberInputMode),
  options: Array.isArray(column.options) ? column.options : [],
  optionColors: normalizeOptionColors(column.optionColors),
  numberRanges: normalizeNumberRanges(column.numberRanges),
  hidden: Boolean(column.hidden),
  alignment: column.alignment ?? 'left',
  overflowMode: normalizeOverflowMode(column.overflowMode, column.inputType, fallbackOverflow),
  widthLimitChars: normalizeWidthLimitChars(column.widthLimitChars),
  lineLimit: normalizeLineLimit(column.lineLimit),
  dateOnly: Boolean(column.dateOnly),
});

export const isWorkspaceLinkValue = (value: WorkspaceCellValue | unknown): value is WorkspaceLinkValue => Boolean(value && typeof value === 'object' && 'url' in value && typeof value.url === 'string' && 'label' in value && typeof value.label === 'string');
export const displayWorkspaceLinkUrl = (url: string) => url.trim().replace(/^https?:\/\//i, '');

export const isWorkspaceUrlText = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (!text || /\s/.test(text)) return false;
  const candidate = /^https?:\/\//i.test(text) ? text : /^(?:www\.)?[\p{L}\d](?:[\p{L}\d.-]*[\p{L}\d])?\.[\p{L}]{2,}(?::\d+)?(?:[/?#].*)?$/iu.test(text) ? `https://${text}` : '';
  if (!candidate) return false;
  try {
    const url = new URL(candidate);
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname.includes('.'));
  } catch {
    return false;
  }
};

export const normalizeWorkspaceDateTime = (value: WorkspaceCellValue): string | null => {
  if (value == null || value === '' || isWorkspaceLinkValue(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export type WorkspaceDateTimeParts = { year: number; month: number; day: number; hour: number; minute: number };

const padDateTimePart = (value: number) => String(value).padStart(2, '0');

export const workspaceDateTimeParts = (value: WorkspaceCellValue): WorkspaceDateTimeParts => {
  const normalized = normalizeWorkspaceDateTime(value);
  const date = normalized ? new Date(normalized) : new Date();
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: date.getHours(), minute: date.getMinutes() };
};

export const workspaceDateTimeFromParts = (parts: WorkspaceDateTimeParts): string | null => {
  const date = new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
  if (Number.isNaN(date.getTime()) || date.getFullYear() !== parts.year || date.getMonth() !== parts.month - 1 || date.getDate() !== parts.day || date.getHours() !== parts.hour || date.getMinutes() !== parts.minute) return null;
  return date.toISOString();
};

export const formatWorkspaceDateTime = (value: WorkspaceCellValue) => {
  const normalized = normalizeWorkspaceDateTime(value);
  if (!normalized) return '';
  const date = new Date(normalized);
  return `${date.getFullYear()}/${padDateTimePart(date.getMonth() + 1)}/${padDateTimePart(date.getDate())} ${padDateTimePart(date.getHours())}:${padDateTimePart(date.getMinutes())}`;
};
export const formatWorkspaceDate = (value: WorkspaceCellValue) => {
  const normalized = normalizeWorkspaceDateTime(value);
  if (!normalized) return '';
  const date = new Date(normalized);
  return `${date.getFullYear()}/${padDateTimePart(date.getMonth() + 1)}/${padDateTimePart(date.getDate())}`;
};
export const workspaceDateMonthKey = (value: WorkspaceCellValue): string | null => {
  const normalized = normalizeWorkspaceDateTime(value);
  if (!normalized) return null;
  const date = new Date(normalized);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};
export const formatWorkspaceDateMonth = (value: WorkspaceCellValue) => {
  const key = workspaceDateMonthKey(value);
  if (!key) return '';
  const [year, month] = key.split('-');
  return `${year}年${Number(month)}月`;
};

export const parseMultiSelectValues = (value: WorkspaceCellValue): string[] => {
  if (value == null || value === '' || isWorkspaceLinkValue(value)) return [];
  const str = String(value).trim();
  if (!str) return [];
  if (str.startsWith('[') && str.endsWith(']')) {
    try {
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch { /* Fallback to delimiter split */ }
  }
  return str.split(/[,，、;；]\s*/).map((s) => s.trim()).filter(Boolean);
};

export const formatMultiSelectValues = (values: string[]): string => values.filter(Boolean).join(', ');

export const displayWorkspaceCellValue = (value: WorkspaceCellValue, inputType?: WorkspaceInputType, isMultiple?: boolean, dateOnly?: boolean) => {
  if (inputType === 'datetime') return dateOnly ? formatWorkspaceDate(value) : formatWorkspaceDateTime(value);
  if (isWorkspaceLinkValue(value)) return value.label.trim() || displayWorkspaceLinkUrl(value.url);
  if (value == null) return '';
  if (isMultiple && typeof value === 'string') {
    const list = parseMultiSelectValues(value);
    if (list.length > 0) return list.join('、');
  }
  return String(value);
};

export const displayWorkspaceColumnValue = (value: WorkspaceCellValue, column: Pick<WorkspaceColumn, 'inputType' | 'isMultiple' | 'dateOnly'>) =>
  displayWorkspaceCellValue(value, column.inputType, column.isMultiple, column.dateOnly);

export const workspaceOptionColor = (column: WorkspaceColumn | undefined, option: string) => column?.inputType === 'select' ? column.optionColors?.[option] : undefined;
export const workspaceNumberRangeColor = (column: WorkspaceColumn | undefined, value: WorkspaceCellValue) => {
  if (column?.inputType !== 'number') return undefined;
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : undefined;
  if (numeric === undefined || !Number.isFinite(numeric)) return undefined;
  return column.numberRanges?.find((range) => (range.min === null || numeric >= range.min) && (range.max === null || numeric <= range.max))?.color;
};
export const workspaceCellColor = (column: WorkspaceColumn | undefined, value: WorkspaceCellValue) => {
  if (!column) return undefined;
  if (column.inputType === 'select' && typeof value === 'string') return workspaceOptionColor(column, value);
  return workspaceNumberRangeColor(column, value);
};

// Columns created before numeric modes were persisted keep the existing adjustment editor.
export const getWorkspaceNumberInputMode = (column: Pick<WorkspaceColumn, 'numberInputMode'>): WorkspaceNumberInputMode => column.numberInputMode ?? 'adjust';

export const getRowHeaderColumn = (table: WorkspaceTable): WorkspaceColumn => normalizeColumn(table.rowHeader
  ? { ...table.rowHeader, name: table.rowHeaderName?.trim() || table.rowHeader.name }
  : {
    id: `row-header-${table.id}`,
    name: table.rowHeaderName?.trim() || DEFAULT_ROW_HEADER_NAME,
    inputType: 'text',
    options: [],
    alignment: 'left',
    overflowMode: 'expand',
  }, 'expand');

const normalizeCellValue = (value: WorkspaceCellValue, inputType: WorkspaceInputType): WorkspaceCellValue => {
  if (inputType === 'link') {
    if (isWorkspaceLinkValue(value)) return { url: value.url, label: value.label };
    return typeof value === 'string' && value.trim() ? { url: value.trim(), label: '' } : null;
  }
  if (inputType === 'datetime') return normalizeWorkspaceDateTime(value);
  if (isWorkspaceLinkValue(value)) return displayWorkspaceCellValue(value) || null;
  return value ?? null;
};

export const normalizeWorkspace = (data: WorkspaceData): WorkspaceData => {
  const tableIds = new Set(data.tables.map((table) => table.id));
  const bottomNavigationTableIds = [...new Set(Array.isArray(data.bottomNavigationTableIds) ? data.bottomNavigationTableIds : [])]
    .filter((tableId): tableId is string => typeof tableId === 'string' && tableIds.has(tableId))
    .slice(0, MAX_BOTTOM_NAVIGATION_TABLES);
  const normalized: WorkspaceData = {
    ...data,
    bottomNavigationTableIds,
    tables: data.tables.map((table) => {
      const rowHeader = getRowHeaderColumn(table);
      const columns = table.columns.map((column) => normalizeColumn(column));
      const changedDynamicColumns = new Set<string>();
      const rows = table.rows.map((row, index) => {
        const name = normalizeCellValue(row.name, rowHeader.inputType) ?? `項目 ${index + 1}`;
        if (rowHeader.inputType === 'dynamic-select' && row.name !== name) changedDynamicColumns.add(rowHeader.id);
        const values = Object.fromEntries(columns.map((column) => {
          const before = row.values[column.id] ?? null;
          const after = normalizeCellValue(before, column.inputType);
          if (column.inputType === 'dynamic-select' && before !== after) changedDynamicColumns.add(column.id);
          return [column.id, after];
        }));
        return { ...row, name, values };
      });
      return {
        ...table,
        rowHeaderName: rowHeader.name,
        rowHeader: changedDynamicColumns.has(rowHeader.id) ? { ...rowHeader, dynamicOptions: undefined } : rowHeader,
        textScale: typeof table.textScale === 'number' && Number.isFinite(table.textScale) ? Math.max(0.1, Math.min(2.5, table.textScale)) : 1,
        transposed: Boolean(table.transposed),
        columns: columns.map(column => changedDynamicColumns.has(column.id) ? { ...column, dynamicOptions: undefined } : column),
        rows,
      };
    }),
  };
  return ensureWorkspaceDynamicOptions(normalized);
};

export const createNode = (type: WorkspaceNode['type'], name: string, parentId: string | null, order: number, tableId?: string): WorkspaceNode => ({
  id: makeId(type), type, name: name.trim() || (type === 'folder' ? '未命名資料夾' : '未命名表格'), parentId, order, ...(tableId ? { tableId } : {}),
});

export const getTableForNode = (data: WorkspaceData, nodeId: string | null) => {
  const node = data.nodes.find((item) => item.id === nodeId && item.type === 'table');
  return node?.tableId ? data.tables.find((table) => table.id === node.tableId) : undefined;
};

export const getChildren = (data: WorkspaceData, parentId: string | null) => data.nodes
  .filter((node) => node.parentId === parentId)
  .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-Hant'));

export type WorkspaceDynamicOptionCounts = Map<string, { count: number; spellings: Map<string, number> }>;

/** A row contributes at most one use per option, including case variants. */
export const dynamicCellOptions = (value: WorkspaceCellValue, isMultiple?: boolean) => {
  const options = new Map<string, string>();
  if (typeof value !== 'string' || !value.trim()) return options;
  const values = isMultiple || /[,，、;；]/.test(value) ? parseMultiSelectValues(value) : [value];
  for (const item of values) {
    const label = item.trim();
    const key = label.toLocaleLowerCase();
    if (label && !options.has(key)) options.set(key, label);
  }
  return options;
};

export const adjustDynamicOptionCounts = (counts: WorkspaceDynamicOptionCounts, value: WorkspaceCellValue, isMultiple: boolean | undefined, delta: 1 | -1) => {
  for (const [key, label] of dynamicCellOptions(value, isMultiple)) {
    let option = counts.get(key);
    if (!option) {
      if (delta < 0) return false;
      option = { count: 0, spellings: new Map() };
      counts.set(key, option);
    }
    const spellingCount = (option.spellings.get(label) ?? 0) + delta;
    if (spellingCount < 0) return false;
    option.count += delta;
    if (spellingCount) option.spellings.set(label, spellingCount);
    else option.spellings.delete(label);
    if (!option.count) counts.delete(key);
  }
  return true;
};

export const sortDynamicOptionCounts = (counts: WorkspaceDynamicOptionCounts) => [...counts.values()]
  .sort((left, right) => right.count - left.count)
  .map((option) => option.spellings.keys().next().value!);

export const collectDynamicOptionCounts = (table: WorkspaceTable, columnId: string) => {
  const rowHeader = getRowHeaderColumn(table);
  const column = columnId === rowHeader.id ? rowHeader : table.columns.find((col) => col.id === columnId);
  const counts: WorkspaceDynamicOptionCounts = new Map();
  for (const row of table.rows) {
    adjustDynamicOptionCounts(counts, columnId === rowHeader.id ? row.name : row.values[columnId], column?.isMultiple, 1);
  }
  return counts;
};

export const getDynamicOptions = (table: WorkspaceTable, columnId: string) => sortDynamicOptionCounts(collectDynamicOptionCounts(table, columnId));

export const readDynamicOptions = (column: WorkspaceColumn, sourceRevision: string): WorkspaceDynamicOptionCounts | undefined => {
  const stored = column.dynamicOptions;
  if (!stored || stored.version !== 1 || stored.sourceRevision !== sourceRevision || stored.isMultiple !== Boolean(column.isMultiple) || !Array.isArray(stored.counts)) return undefined;
  const counts: WorkspaceDynamicOptionCounts = new Map();
  for (const item of stored.counts) {
    if (!item || typeof item.key !== 'string' || !item.key || counts.has(item.key) || !Number.isSafeInteger(item.count) || item.count <= 0 || !Array.isArray(item.spellings)) return undefined;
    const spellings = new Map<string, number>();
    let total = 0;
    for (const pair of item.spellings) {
      if (!Array.isArray(pair) || pair.length !== 2) return undefined;
      const [label, count] = pair;
      if (typeof label !== 'string' || !label || label !== label.trim() || label.toLocaleLowerCase() !== item.key || spellings.has(label) || !Number.isSafeInteger(count) || count <= 0) return undefined;
      spellings.set(label, count);
      total += count;
    }
    if (total !== item.count) return undefined;
    counts.set(item.key, { count: total, spellings });
  }
  return counts;
};

export const writeDynamicOptions = (counts: WorkspaceDynamicOptionCounts, sourceRevision: string, isMultiple: boolean): WorkspaceDynamicOptions => ({
  version: 1, sourceRevision, isMultiple,
  counts: [...counts].map(([key, option]) => ({ key, count: option.count, spellings: [...option.spellings] })),
});

/** Old tables and imported text acquire their column statistics once, before use. */
export const ensureTableDynamicOptions = (table: WorkspaceTable): WorkspaceTable => {
  const sourceRevision = workspaceTableChangeRevision(table);
  const prepare = (column: WorkspaceColumn) => {
    if (column.inputType !== 'dynamic-select') return column.dynamicOptions ? { ...column, dynamicOptions: undefined } : column;
    if (readDynamicOptions(column, sourceRevision)) return column;
    return { ...column, dynamicOptions: writeDynamicOptions(collectDynamicOptionCounts(table, column.id), sourceRevision, Boolean(column.isMultiple)) };
  };
  const rowHeader = table.rowHeader ? prepare(table.rowHeader) : undefined;
  const columns = table.columns.map(prepare);
  return rowHeader === table.rowHeader && columns.every((column, index) => column === table.columns[index]) ? table : { ...table, rowHeader, columns };
};

export const ensureWorkspaceDynamicOptions = (data: WorkspaceData): WorkspaceData => {
  const tables = data.tables.map(ensureTableDynamicOptions);
  return tables.every((table, index) => table === data.tables[index]) ? data : { ...data, tables };
};

export const resolveActiveTableNodeId = (data: WorkspaceData, preferredNodeId = data.activeNodeId) => {
  const tableIds = new Set(data.tables.map((table) => table.id));
  const isAvailableTable = (node: WorkspaceNode) => node.type === 'table' && Boolean(node.tableId && tableIds.has(node.tableId));
  const preferredNode = preferredNodeId ? data.nodes.find((node) => node.id === preferredNodeId) : undefined;
  return preferredNode && isAvailableTable(preferredNode)
    ? preferredNode.id
    : data.nodes.find(isAvailableTable)?.id ?? null;
};

export const coerceCellValue = (column: WorkspaceColumn, raw: string): WorkspaceCellValue => {
  if (!raw.trim()) return null;
  if (column.inputType === 'link') return { url: raw.trim(), label: '' };
  if (column.inputType === 'datetime') return normalizeWorkspaceDateTime(raw);
  if (column.inputType !== 'number') return raw;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

export const removeNodeAndDescendants = (data: WorkspaceData, nodeId: string): WorkspaceData => {
  const removedIds = new Set<string>([nodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of data.nodes) {
      if (node.parentId && removedIds.has(node.parentId) && !removedIds.has(node.id)) {
        removedIds.add(node.id);
        changed = true;
      }
    }
  }
  const tableIds = new Set(data.nodes.filter((node) => removedIds.has(node.id) && node.tableId).map((node) => node.tableId));
  const remaining = {
    ...data,
    nodes: data.nodes.filter((node) => !removedIds.has(node.id)),
    tables: data.tables.filter((table) => !tableIds.has(table.id)),
    bottomNavigationTableIds: (data.bottomNavigationTableIds ?? []).filter((tableId) => !tableIds.has(tableId)),
  };
  return { ...remaining, activeNodeId: resolveActiveTableNodeId(remaining) };
};

export const moveNode = (data: WorkspaceData, nodeId: string, parentId: string | null): WorkspaceData => {
  const node = data.nodes.find((item) => item.id === nodeId);
  if (!node || node.parentId === parentId || parentId === nodeId) return data;
  if (parentId) {
    const parent = data.nodes.find((item) => item.id === parentId);
    if (!parent || parent.type !== 'folder') return data;
    let ancestor: WorkspaceNode | undefined = parent;
    while (ancestor) {
      if (ancestor.id === nodeId) return data;
      ancestor = ancestor.parentId ? data.nodes.find((item) => item.id === ancestor?.parentId) : undefined;
    }
  }
  const destinationOrder = getChildren(data, parentId).filter((item) => item.id !== nodeId).length;
  return { ...data, nodes: data.nodes.map((item) => item.id === nodeId ? { ...item, parentId, order: destinationOrder } : item) };
};
