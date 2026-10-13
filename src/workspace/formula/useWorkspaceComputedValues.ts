import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { WorkspaceTable } from '../types';
import { isPendingWorkspaceRow } from '../rowPages';
import { runWorkspaceIdleSteps } from '../workspaceIdleSteps';
import { createWorkspaceValueReader } from './values';

/** Visible cells are immediate. Optional warming never reads the DB or updates React state. */
export const useWorkspaceComputedValues = (table: WorkspaceTable | undefined) => {
  const ownerId = table?.id;
  const reader = useMemo(() => createWorkspaceValueReader(), [ownerId]);
  const latest = useRef(table);
  useLayoutEffect(() => { latest.current = table; }, [table]);
  const formulas = useMemo(() => table?.columns.filter(column => column.formula) ?? [], [table?.columns]);
  const previousFormulas = useRef(formulas);
  const stableFormulas = formulas.length === previousFormulas.current.length && formulas.every((column, index) => column.id === previousFormulas.current[index].id && column.formula === previousFormulas.current[index].formula) ? previousFormulas.current : formulas;
  useLayoutEffect(() => {
    previousFormulas.current = stableFormulas;
    reader.retainColumns(new Set(stableFormulas.map(column => column.id)));
  }, [reader, stableFormulas]);
  useEffect(() => {
    if (!stableFormulas.length) return;
    const controller = new AbortController();
    function* warm() {
      const ids = new Set<string>();
      for (let index = 0; index < (latest.current?.rows.length ?? 0); index++) {
        const row = latest.current!.rows[index];
        ids.add(row.id);
        if (!isPendingWorkspaceRow(row)) for (const column of stableFormulas) reader.read(row, column);
        yield;
      }
      reader.retainRows(ids);
    }
    void runWorkspaceIdleSteps(warm(), { signal: controller.signal, isCurrent: () => latest.current?.id === ownerId && previousFormulas.current === stableFormulas, canRun: () => document.visibilityState !== 'hidden' });
    return () => controller.abort();
  }, [reader, stableFormulas, ownerId, table?.rows.length]);
  return reader.read;
};
