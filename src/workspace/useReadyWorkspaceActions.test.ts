import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useReadyWorkspaceActions, type WorkspaceReadiness } from './useReadyWorkspaceActions';

describe('actions awaiting complete workspace data', () => {
  it('resumes the original input against the complete table from the latest render', async () => {
    let finish!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    const incomplete = vi.fn(), complete = vi.fn();
    const readiness: WorkspaceReadiness = { isReady: () => false, ensure: () => waiting, ownerKey: () => 'table', onError: vi.fn() };
    const { result, rerender } = renderHook(({ save }) => useReadyWorkspaceActions({ save }, { save: 'active' }, readiness), { initialProps: { save: incomplete } });
    result.current.save('clipboard contents');
    expect(incomplete).not.toHaveBeenCalled();
    rerender({ save: complete });
    await act(async () => { finish(); await waiting; });
    expect(complete).toHaveBeenCalledExactlyOnceWith('clipboard contents');
  });

  it('cancels an active-table operation after navigation while allowing an explicit full export', async () => {
    let owner = 'first', finish!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    const edit = vi.fn(), exportAll = vi.fn();
    const readiness: WorkspaceReadiness = { isReady: () => false, ensure: () => waiting, ownerKey: () => owner, onError: vi.fn() };
    const { result } = renderHook(() => useReadyWorkspaceActions({ edit, exportAll }, { edit: 'active', exportAll: 'all' }, readiness));
    result.current.edit(); result.current.exportAll(); owner = 'second';
    await act(async () => { finish(); await waiting; });
    expect(edit).not.toHaveBeenCalled(); expect(exportAll).toHaveBeenCalledOnce();
  });

  it('does not resume UI operations after the workspace unmounts', async () => {
    let finish!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    const edit = vi.fn();
    const readiness: WorkspaceReadiness = { isReady: () => false, ensure: () => waiting, onError: vi.fn() };
    const { result, unmount } = renderHook(() => useReadyWorkspaceActions({ edit }, { edit: 'active' }, readiness));
    result.current.edit(); unmount();
    await act(async () => { finish(); await waiting; });
    expect(edit).not.toHaveBeenCalled();
  });
});
