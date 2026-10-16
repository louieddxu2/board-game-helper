import type { RefObject } from 'react';
import type { WorkspaceTableMutation } from './history';
import type { WorkspaceData, WorkspaceTable } from './types';

export type CellHoldSession = {
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  cell: HTMLTableCellElement;
  columnId: string;
  lastRowId: string;
  directionX: number;
  directionY: number;
  timer?: number;
  active: boolean;
  canSweep: boolean;
  startedInLane: boolean;
  immediate: boolean;
  blockTap: boolean;
  canTap: boolean;
  mode: 'pending' | 'selecting';
};

export type TableHeaderTapTarget = { kind: 'row' | 'column'; id: string } | { kind: 'corner' };

export type TableHeaderTapSession = {
  pointerId: number;
  startX: number;
  startY: number;
  cell: HTMLTableCellElement;
  target: TableHeaderTapTarget;
};

export interface UseTableGesturesProps {
  table: WorkspaceTable | undefined;
  data: WorkspaceData | undefined;
  commit: (next: WorkspaceData, mutation?: WorkspaceTableMutation) => void;
  viewportRef: RefObject<HTMLDivElement | null>;
  workspacePageRef: RefObject<HTMLElement | null>;
  setNotice: (msg: string) => void;
  minTextScale: number;
  onCellLongPress?: (rowId: string, columnId: string) => boolean | void;
  onCellSweep?: (fromRowId: string, toRowId: string, columnId: string) => void;
  onCellTap?: (rowId: string, columnId: string) => void;
  onHeaderTap?: (target: TableHeaderTapTarget) => void;
  bulkSelectionColumnId?: string;
  onDrawerSwipeProgress?: (deltaX: number) => void;
  onDrawerSwipeEnd?: (deltaX: number) => void;
  onOpenSearch?: () => void;
  onRevealTopRow?: () => void;
  searchOpen?: boolean;
  ensureTableReady?: () => Promise<void>;
  onReadError?: (error: unknown) => void;
  onPersistTextScale?: (tableId: string, scale: number) => void;
}
