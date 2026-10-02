import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { WorkspaceColumn, WorkspaceRow, WorkspaceTable } from './types';
import type { HeaderFilterAggregate, HeaderFilterState, HeaderFilterTarget } from './workspaceShared';
import type { DateFilterPrecision } from './dateFilter';
import { displayWorkspaceCellValue, formatWorkspaceDateMonth, parseMultiSelectValues, workspaceCellColor, workspaceDateMonthKey, workspaceOptionColor } from './model';
import { compareWorkspaceCellValues, hasWorkspaceFilterCriteria, matchesWorkspaceFilter, numericWorkspaceValue, searchableWorkspaceCellValue, workspaceFilterValueKey, workspaceValueCollator } from './workspaceShared';
import { loadWorkspaceTableViewState, saveWorkspaceTableViewState } from './viewState';

interface UseWorkspaceFilterProps {
  table: WorkspaceTable | undefined;
  rowHeader: WorkspaceColumn | undefined;
  tableRowsById: Map<string, WorkspaceRow>;
}

export function useWorkspaceFilter({ table, rowHeader, tableRowsById }: UseWorkspaceFilterProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [headerFilters, setHeaderFilters] = useState<Record<string, HeaderFilterState>>({});
  const [filterTarget, setFilterTarget] = useState<HeaderFilterTarget>();
  const [viewTableId, setViewTableId] = useState<string>();
  const [scrollPosition, setScrollPosition] = useState({ left: 0, top: 0 });

  useEffect(() => {
    if (!table) {
      setViewTableId(undefined);
      setSearchQuery('');
      setSearchOpen(false);
      setHeaderFilters({});
      setFilterTarget(undefined);
      setScrollPosition({ left: 0, top: 0 });
      return;
    }
    const restored = loadWorkspaceTableViewState(table.id);
    setViewTableId(table.id);
    setSearchQuery(restored.searchQuery);
    setSearchOpen(restored.searchOpen);
    setHeaderFilters(restored.headerFilters);
    setFilterTarget(undefined);
    setScrollPosition({ left: restored.scrollLeft, top: restored.scrollTop });
  }, [table?.id]);

  useEffect(() => {
    if (!table || viewTableId !== table.id) return;
    saveWorkspaceTableViewState(table.id, { searchQuery, searchOpen, headerFilters, scrollLeft: scrollPosition.left, scrollTop: scrollPosition.top });
  }, [headerFilters, searchOpen, searchQuery, scrollPosition.left, scrollPosition.top, table, viewTableId]);

  const deferredSearchQuery = useDeferredValue(searchQuery);

  const searchedRows = useMemo(() => {
    if (!table) return [];
    const query = deferredSearchQuery.trim().toLocaleLowerCase();
    if (!query) return table.rows;
    return table.rows.filter((row) => [
      { value: row.name, inputType: rowHeader?.inputType, dateOnly: rowHeader?.dateOnly },
      ...table.columns.map((column) => ({ value: row.values[column.id] ?? null, inputType: column.inputType, dateOnly: column.dateOnly })),
    ].some(({ value, inputType, dateOnly }) => searchableWorkspaceCellValue(value, inputType, dateOnly).toLocaleLowerCase().includes(query)));
  }, [deferredSearchQuery, rowHeader, table?.columns, table?.rows]);

  const filteredRows = useMemo(() => {
    if (!table || !rowHeader) return [];
    const columnsById = new Map([...table.columns, rowHeader].map((column) => [column.id, column]));
    const columnFilters = Object.entries(headerFilters)
      .filter(([key, state]) => key.startsWith('column:') && columnsById.has(key.slice(7)) && hasWorkspaceFilterCriteria(state))
      .map(([key, state]) => ({ column: columnsById.get(key.slice(7))!, state, includedKeys: state.includedKeys === null ? undefined : new Set(state.includedKeys) }));
    const rows = columnFilters.length ? searchedRows.filter((row) => columnFilters.every(({ column, state, includedKeys }) => {
      const columnId = column.id;
      const value = columnId === rowHeader.id ? row.name : row.values[columnId] ?? null;
      return matchesWorkspaceFilter(value, column.inputType, state, column.isMultiple, includedKeys);
    })) : searchedRows;
    const sortedEntry = Object.entries(headerFilters).find(([key, state]) => key.startsWith('column:') && columnsById.has(key.slice(7)) && state.sort);
    if (!sortedEntry) return rows;
    const [key, state] = sortedEntry;
    const columnId = key.slice(7);
    const column = columnsById.get(columnId)!;
    const direction = state.sort === 'desc' ? -1 : 1;
    return rows.map((row, index) => ({ row, index })).sort((left, right) => {
      const leftValue = columnId === rowHeader.id ? left.row.name : left.row.values[columnId] ?? null;
      const rightValue = columnId === rowHeader.id ? right.row.name : right.row.values[columnId] ?? null;
      return compareWorkspaceCellValues(leftValue, rightValue, column?.inputType, column?.dateOnly) * direction || left.index - right.index;
    }).map(({ row }) => row);
  }, [headerFilters, rowHeader, searchedRows, table?.columns]);

  const visibleColumns = useMemo(() => {
    if (!table) return [];
    const visibleRowIds = new Set(filteredRows.map((row) => row.id));
    const rowFilters = Object.entries(headerFilters)
      .filter(([key, state]) => key.startsWith('row:') && visibleRowIds.has(key.slice(4)) && hasWorkspaceFilterCriteria(state))
      .map(([key, state]) => ({ row: tableRowsById.get(key.slice(4)), state, includedKeys: state.includedKeys === null ? undefined : new Set(state.includedKeys) }));
    const columns = table.columns.filter((column) => rowFilters.every(({ row, state, includedKeys }) => {
      return Boolean(row && matchesWorkspaceFilter(row.values[column.id] ?? null, column.inputType, state, column.isMultiple, includedKeys));
    }));
    const sortedEntry = Object.entries(headerFilters).find(([key, state]) => key.startsWith('row:') && visibleRowIds.has(key.slice(4)) && state.sort);
    if (!sortedEntry) return columns;
    const [key, state] = sortedEntry;
    const row = tableRowsById.get(key.slice(4));
    if (!row) return columns;
    const direction = state.sort === 'desc' ? -1 : 1;
    return columns.map((column, index) => ({ column, index })).sort((left, right) => compareWorkspaceCellValues(row.values[left.column.id] ?? null, row.values[right.column.id] ?? null, left.column.inputType) * direction || left.index - right.index).map(({ column }) => column);
  }, [filteredRows, headerFilters, table?.columns, tableRowsById]);

  const activeFilterKey = filterTarget ? `${filterTarget.axis}:${filterTarget.id}` : '';
  const activeFilterState = headerFilters[activeFilterKey] ?? { includedKeys: null, sort: null };

  const activeFilterOptions = useMemo(() => {
    if (!table || !rowHeader || !filterTarget) return [];
    const targetColumn = filterTarget.axis === 'column' ? (filterTarget.id === rowHeader.id ? rowHeader : table.columns.find((column) => column.id === filterTarget.id)) : undefined;
    const values = filterTarget.axis === 'column'
      ? table.rows.map((row) => ({ value: filterTarget.id === rowHeader.id ? row.name : row.values[filterTarget.id] ?? null, column: targetColumn }))
      : table.columns.map((column) => ({ value: tableRowsById.get(filterTarget.id)?.values[column.id] ?? null, column }));
    const unique = new Map<string, { key: string; label: string; count: number; color?: string }>();
    for (const { value, column } of values) {
      const inputType = column?.inputType;
      const isMultiple = column?.isMultiple;
      if (inputType === 'datetime') {
        const monthKey = workspaceDateMonthKey(value);
        const key = monthKey ? `date-month:${monthKey}` : workspaceFilterValueKey(null);
        const existing = unique.get(key);
        if (existing) existing.count += 1;
        else unique.set(key, { key, label: monthKey ? formatWorkspaceDateMonth(value) : '（空白）', count: 1 });
        continue;
      }
      const list = (isMultiple || (typeof value === 'string' && /[,，、;；]/.test(value))) ? parseMultiSelectValues(value) : null;
      if (list && list.length > 0) {
        for (const item of list) {
          const key = workspaceFilterValueKey(item);
          const existing = unique.get(key);
          if (existing) existing.count += 1;
          else unique.set(key, { key, label: item, count: 1, color: workspaceOptionColor(column, item) });
        }
      } else {
        const key = workspaceFilterValueKey(value);
        const existing = unique.get(key);
        if (existing) existing.count += 1;
        else unique.set(key, { key, label: displayWorkspaceCellValue(value, inputType) || '（空白）', count: 1, color: workspaceCellColor(column, value) });
      }
    }
    return [...unique.values()].sort((left, right) => left.key.startsWith('date-month:') && right.key.startsWith('date-month:') ? left.key.localeCompare(right.key) : workspaceValueCollator.compare(left.label, right.label));
  }, [filterTarget, rowHeader, table, tableRowsById]);

  const activeFilterInputType = useMemo(() => {
    if (!table || !rowHeader || !filterTarget) return undefined;
    if (filterTarget.axis === 'column') return filterTarget.id === rowHeader.id ? rowHeader.inputType : table.columns.find((column) => column.id === filterTarget.id)?.inputType;
    if (!table.columns.length || !tableRowsById.has(filterTarget.id)) return undefined;
    const firstType = table.columns[0].inputType;
    return table.columns.every((column) => column.inputType === firstType) ? firstType : undefined;
  }, [filterTarget, rowHeader, table, tableRowsById]);

  const activeNumericValues = useMemo(() => {
    if (activeFilterInputType !== 'number' || !filterTarget) return [];
    const values = filterTarget.axis === 'column'
      ? filteredRows.map((row) => filterTarget.id === rowHeader?.id ? row.name : row.values[filterTarget.id] ?? null)
      : (() => {
        const row = tableRowsById.get(filterTarget.id);
        return row ? visibleColumns.map((column) => row.values[column.id] ?? null) : [];
      })();
    return values.map(numericWorkspaceValue).filter((value): value is number => value !== undefined);
  }, [activeFilterInputType, filterTarget, filteredRows, rowHeader, tableRowsById, visibleColumns]);

  const updateActiveFilter = (updater: (state: HeaderFilterState) => HeaderFilterState) => {
    if (!activeFilterKey) return;
    setHeaderFilters((current) => ({ ...current, [activeFilterKey]: updater(current[activeFilterKey] ?? { includedKeys: null, sort: null }) }));
  };
  const setActiveFilterSort = (direction: 'asc' | 'desc') => {
    if (!activeFilterKey) return;
    setHeaderFilters((current) => {
      const next = Object.fromEntries(Object.entries(current).map(([key, state]) => [key, { ...state, sort: null }])) as Record<string, HeaderFilterState>;
      const state = current[activeFilterKey] ?? { includedKeys: null, sort: null };
      next[activeFilterKey] = { ...state, sort: state.sort === direction ? null : direction };
      return next;
    });
  };
  const setActiveFilterQuery = (query: string) => updateActiveFilter((state) => ({ ...state, query }));
  const setActiveFilterRange = (min: string, max: string) => updateActiveFilter((state) => ({ ...state, min, max }));
  const setActiveDateRange = (min: string, max: string, datePrecision: DateFilterPrecision) => updateActiveFilter((state) => ({ ...state, min, max, datePrecision, includedKeys: null }));
  const clearActiveDateRange = () => updateActiveFilter((state) => ({ ...state, min: '', max: '', datePrecision: undefined, includedKeys: null }));
  const setActiveFilterAggregate = (aggregate: HeaderFilterAggregate) => updateActiveFilter((state) => ({ ...state, aggregate }));
  const toggleActiveFilterOption = (key: string) => updateActiveFilter((state) => {
    const selected = state.includedKeys === null ? new Set(activeFilterOptions.map((option) => option.key)) : new Set(state.includedKeys);
    if (selected.has(key)) selected.delete(key); else selected.add(key);
    return { ...state, includedKeys: selected.size === activeFilterOptions.length ? null : [...selected] };
  });
  const isHeaderFilterActive = (axis: HeaderFilterTarget['axis'], id: string) => {
    const state = headerFilters[`${axis}:${id}`];
    return Boolean(state && (hasWorkspaceFilterCriteria(state) || state.sort));
  };

  const clearFilters = () => {
    setHeaderFilters({});
    setFilterTarget(undefined);
  };

  return {
    searchQuery, setSearchQuery, searchOpen, setSearchOpen,
    headerFilters, setHeaderFilters, filterTarget, setFilterTarget,
    searchedRows, filteredRows, visibleColumns, clearFilters,
    activeFilterKey, activeFilterState, activeFilterOptions, activeFilterInputType, activeNumericValues,
    setActiveFilterSort, setActiveFilterQuery, setActiveFilterRange, setActiveDateRange, clearActiveDateRange, setActiveFilterAggregate, toggleActiveFilterOption,
    updateActiveFilter, isHeaderFilterActive,
    viewStateReady: Boolean(table && viewTableId === table.id), scrollPosition, setScrollPosition
  };
}
