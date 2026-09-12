import { useState } from 'react';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importWorkspaceArchive, importWorkspaceXlsx, type ImportedWorkspace } from './spreadsheet';
import type { WorkspaceData, WorkspaceTable } from './types';
import { useWorkspaceActions, type WorkspaceTableImportPreview } from './useWorkspaceActions';

vi.mock('./spreadsheet', async (importOriginal) => ({
  ...await importOriginal<typeof import('./spreadsheet')>(),
  importWorkspaceXlsx: vi.fn(),
  importWorkspaceArchive: vi.fn(),
}));

const table: WorkspaceTable = { id: 'imported', name: 'Imported', rowHeaderName: '物件', columns: [], rows: [], updatedAt: 0 };
const data: WorkspaceData = {
  version: 1, activeNodeId: null, tables: [],
  nodes: ['A', 'B'].map((id, order) => ({ id, type: 'folder', name: id, parentId: null, order })),
};
const parsedTable = (id: string): ImportedWorkspace => ({ isWorkspace: false, source: 'plain', table: { ...table, id, name: id } });
const deferred = () => {
  let resolve!: (value: ImportedWorkspace) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ImportedWorkspace>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const makeProps = (): Parameters<typeof useWorkspaceActions>[0] => ({
  data, table: undefined, rowHeader: undefined,
  commit: vi.fn(), setNotice: vi.fn(), setExpanded: vi.fn(), setDrawerOpen: vi.fn(),
  setEditing: vi.fn(), setFocusTarget: vi.fn(), setSelectionEditor: vi.fn(), setConfiguring: vi.fn(),
  setNodeMenu: vi.fn(), setMovingNode: vi.fn(), setTableActionsOpen: vi.fn(), setTableCreateParentId: vi.fn(),
  setNameDialog: vi.fn(), setConfirmDialog: vi.fn(), setWorkspaceImport: vi.fn(), setTableImportPreview: vi.fn(),
  onExported: vi.fn(), nameDialog: undefined, selectionEditor: undefined, configuring: undefined, workspaceImport: undefined,
});

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('Workspace import ownership', () => {
  it('keeps the selected folder through parsing and preview confirmation', async () => {
    const pending = deferred();
    vi.mocked(importWorkspaceXlsx).mockReturnValueOnce(pending.promise);
    const props = makeProps();
    const { result } = renderHook(() => useWorkspaceActions(props));
    result.current.importTableParentId.current = 'A';
    const reading = result.current.readImport(new File([], 'table.xlsx'), 'table');
    result.current.importTableParentId.current = 'B';
    await act(async () => { pending.resolve(parsedTable('first')); await reading; });

    const preview = vi.mocked(props.setTableImportPreview).mock.calls[0][0]!;
    expect(preview.parentId).toBe('A');
    act(() => result.current.finishTableImport(preview.table, preview.parentId));
    expect(props.commit).toHaveBeenCalledWith(expect.objectContaining({
      nodes: expect.arrayContaining([expect.objectContaining({ tableId: 'first', parentId: 'A' })]),
    }));
  });

  it.each(['success', 'failure'] as const)('ignores an older table result after the newer selection succeeds (%s)', async (outcome) => {
    const first = deferred();
    const second = deferred();
    vi.mocked(importWorkspaceXlsx).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const props = makeProps();
    const { result } = renderHook(() => useWorkspaceActions(props));
    const readingFirst = result.current.readImport(new File([], 'first.xlsx'), 'table');
    const readingSecond = result.current.readImport(new File([], 'second.xlsx'), 'table');
    await act(async () => { second.resolve(parsedTable('second')); await readingSecond; });
    vi.mocked(props.setTableImportPreview).mockClear();
    vi.mocked(props.setNotice).mockClear();

    await act(async () => {
      if (outcome === 'success') first.resolve(parsedTable('first'));
      else first.reject(new Error('older parser failed'));
      await readingFirst;
    });
    expect(props.setTableImportPreview).not.toHaveBeenCalled();
    expect(props.setNotice).not.toHaveBeenCalled();
  });

  it('shares latest-selection ownership between table and database files', async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(importWorkspaceXlsx).mockReturnValueOnce(first.promise);
    vi.mocked(importWorkspaceArchive).mockReturnValueOnce(second.promise);
    const props = makeProps();
    const { result } = renderHook(() => useWorkspaceActions(props));
    const readingFirst = result.current.readImport(new File([], 'first.xlsx'), 'table');
    const readingSecond = result.current.readImport(new File([], 'second.zip'), 'workspace');
    await act(async () => { second.resolve({ isWorkspace: true, source: 'workspace', data }); await readingSecond; });
    await act(async () => { first.resolve(parsedTable('first')); await readingFirst; });
    expect(props.setWorkspaceImport).toHaveBeenCalledWith(data);
    expect(props.setTableImportPreview).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure'] as const)('does not publish a late %s into the surviving host after the import owner unmounts', async (outcome) => {
    const pending = deferred();
    vi.mocked(importWorkspaceXlsx).mockReturnValueOnce(pending.promise);
    let actions!: ReturnType<typeof useWorkspaceActions>;
    const props = makeProps();
    const ImportOwner = ({ setNotice, setTableImportPreview }: Pick<typeof props, 'setNotice' | 'setTableImportPreview'>) => {
      actions = useWorkspaceActions({ ...props, setNotice, setTableImportPreview });
      return null;
    };
    const Host = ({ showOwner }: { showOwner: boolean }) => {
      const [notice, setNotice] = useState('');
      const [preview, setTableImportPreview] = useState<WorkspaceTableImportPreview>();
      return <>{showOwner && <ImportOwner setNotice={setNotice} setTableImportPreview={setTableImportPreview} />}<output data-testid="notice">{notice}</output><output data-testid="preview">{preview?.table.name ?? 'none'}</output></>;
    };
    const view = render(<Host showOwner />);
    let reading!: Promise<void>;
    act(() => { reading = actions.readImport(new File([], 'late.xlsx'), 'table'); });
    const initialNotice = screen.getByTestId('notice').textContent;
    view.rerender(<Host showOwner={false} />);
    await act(async () => {
      if (outcome === 'success') pending.resolve(parsedTable('late'));
      else pending.reject(new Error('late parser failed'));
      await reading;
    });
    expect(screen.getByTestId('preview')).toHaveTextContent('none');
    expect(screen.getByTestId('notice').textContent).toBe(initialNotice);
  });
});
