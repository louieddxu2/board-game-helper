import { useEffect, useLayoutEffect, useRef } from 'react';
import { prepareWorkspaceColumnSaveAsync } from './columnConversion';
import type { WorkspaceCommitOptions, WorkspaceTableMutation } from './history';
import { ensureTableDynamicOptionsSteps } from './model';
import type { WorkspaceColumn, WorkspaceData, WorkspaceTable } from './types';
import type { WorkspaceDialogController } from './useWorkspaceDialogs';
import { runWorkspaceCooperativeSteps } from './workspaceCooperativeWork';
import { updateTable } from './workspaceShared';

interface WorkspaceColumnSaveOptions {
  dataRef: React.RefObject<WorkspaceData | undefined>;
  table: WorkspaceTable | undefined;
  dialogs: WorkspaceDialogController;
  commit(next: WorkspaceData, mutation?: WorkspaceTableMutation, options?: WorkspaceCommitOptions): void;
}

/** Prepare a draft without publishing partial conversions or overwriting a newer table. */
export const useWorkspaceColumnSave = ({ dataRef, table, dialogs, commit }: WorkspaceColumnSaveOptions) => {
  const latest = useRef({ table, configuring: dialogs.state.configuring });
  const generation = useRef(0);
  const mounted = useRef(true);
  useLayoutEffect(() => { latest.current = { table, configuring: dialogs.state.configuring }; });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current += 1; }; }, []);

  return async (column: WorkspaceColumn): Promise<string | void> => {
    const configuring = latest.current.configuring;
    const source = latest.current.table;
    const owner = dataRef.current?.activeNodeId;
    if (!source || !configuring || column.id !== configuring.column.id) return;
    const request = ++generation.current;
    const checkCurrent = () => {
      if (!mounted.current || request !== generation.current || latest.current.configuring !== configuring || dataRef.current?.activeNodeId !== owner) {
        throw new DOMException('屬性儲存已取消', 'AbortError');
      }
      if (dataRef.current?.tables.find(item => item.id === source.id) !== source) {
        throw new Error('表格已有變更，請重新儲存屬性設定');
      }
    };
    try {
      const prepared = await prepareWorkspaceColumnSaveAsync(source, column, checkCurrent);
      const counted = await runWorkspaceCooperativeSteps(ensureTableDynamicOptionsSteps(prepared.table), checkCurrent);
      checkCurrent();
      const changes = prepared.changes.length ? prepared.changes : undefined;
      const action: WorkspaceTableMutation['action'] = configuring.isRowHeader
        ? { type: 'update-row-header', before: source.rowHeader, after: counted.rowHeader, beforeName: source.rowHeaderName, afterName: counted.rowHeaderName, changes }
        : { type: 'update-column', before: source.columns.find(item => item.id === column.id)!, after: counted.columns.find(item => item.id === column.id)!, changes };
      commit(updateTable(dataRef.current!, source.id, () => ({ ...counted, updatedAt: Date.now() })), changes ? {
        tableId: source.id, label: configuring.isRowHeader ? '設定物件屬性' : '設定屬性', action,
      } : undefined, { preparedTableIds: [source.id] });
      dialogs.close('configuring');
    } catch (error) {
      if (error instanceof Error || error instanceof DOMException) {
        if (error.name === 'AbortError') return;
        return error.message;
      }
      throw error;
    }
  };
};
