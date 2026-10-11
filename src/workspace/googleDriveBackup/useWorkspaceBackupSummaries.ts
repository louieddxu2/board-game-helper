import { useEffect, useMemo, useState } from 'react';
import type { WorkspaceData } from '../types';
import { workspaceStructureChangeRevision } from '../changeRevisions';
import { workspaceBackupTableSummary, type WorkspaceBackupTableSummary } from '../workspaceBackupSource';

export type WorkspaceBackupSummaryLoader = (data: WorkspaceData) => Promise<WorkspaceBackupTableSummary[]>;

/** Inspect unloaded tables using headers; live resident revisions always take precedence. */
export const useWorkspaceBackupSummaries = (data: WorkspaceData | undefined, enabled: boolean, load?: WorkspaceBackupSummaryLoader) => {
  const [catalog, setCatalog] = useState<{ key: string; tables: WorkspaceBackupTableSummary[] }>();
  const [error, setError] = useState<{ key: string; message: string }>();
  const missingIds = data?.nodes.flatMap(node => node.type === 'table' && node.tableId && !data.tables.some(table => table.id === node.tableId) ? [node.tableId] : []) ?? [];
  const key = data ? JSON.stringify([workspaceStructureChangeRevision(data), missingIds]) : '';
  useEffect(() => {
    if (!enabled || !data || !load || !missingIds.length || catalog?.key === key) return;
    let cancelled = false;
    void load(data).then(tables => {
      if (!cancelled) { setCatalog({ key, tables }); setError(undefined); }
    }).catch(cause => {
      if (!cancelled) setError({ key, message: cause instanceof Error ? cause.message : '無法讀取備份表格目錄' });
    });
    return () => { cancelled = true; };
  }, [data, enabled, key, load, catalog?.key]);
  const tables = useMemo(() => {
    if (!data || (load && missingIds.length && catalog?.key !== key)) return undefined;
    const summaries = new Map((catalog?.key === key ? catalog.tables : []).map(table => [table.id, table]));
    for (const table of data.tables) summaries.set(table.id, workspaceBackupTableSummary(table));
    return [...summaries.values()];
  }, [data, load, catalog, key]);
  return { tables, error: error?.key === key ? error.message : undefined };
};
