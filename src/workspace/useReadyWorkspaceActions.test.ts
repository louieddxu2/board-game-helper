import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useReadyWorkspaceActions, type WorkspaceReadiness } from './useReadyWorkspaceActions';

describe('actions awaiting complete workspace data', () => {
  it('resolves the latest target and returns the delayed operation result', async () => {
    let finish!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    const save = vi.fn(async () => 'saved');
    const readiness: WorkspaceReadiness = { isReady: () => false, ensure: vi.fn(() => waiting), onError: vi.fn() };
    const { result, rerender } = renderHook(({ id }) => useReadyWorkspaceActions({ save }, { save: () => ({ tableId: id }) }, readiness), { initialProps: { id: 'old' } });
    rerender({ id: 'target' });
    const saving = result.current.save();
    expect(readiness.ensure).toHaveBeenCalledExactlyOnceWith({ tableId: 'target' });
    await act(async () => { finish(); expect(await saving).toBe('saved'); });
    expect(save).toHaveBeenCalledOnce();
  });

  it('discards a pending rename when its dialog targets a different table', async () => {
    let finish!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    const save = vi.fn();
    const readiness: WorkspaceReadiness = { isReady: () => false, ensure: () => waiting, onError: vi.fn() };
    const { result, rerender } = renderHook(({ id }) => useReadyWorkspaceActions({ save }, { save: () => ({ tableId: id }) }, readiness), { initialProps: { id: 'first' } });
    result.current.save();
    rerender({ id: 'second' });
    await act(async () => { finish(); await waiting; });
    expect(save).not.toHaveBeenCalled();
  });

  it('does not replay an old rename into a reopened dialog for the same table', async () => {
    let finish!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    const save = vi.fn();
    const readiness: WorkspaceReadiness = { isReady: () => false, ensure: () => waiting, onError: vi.fn() };
    const { result, rerender } = renderHook(({ requestKey }) => useReadyWorkspaceActions({ save }, { save: () => ({ tableId: 'same', requestKey }) }, readiness), { initialProps: { requestKey: {} } });
    result.current.save();
    rerender({ requestKey: {} });
    await act(async () => { finish(); await waiting; });
    expect(save).not.toHaveBeenCalled();
  });

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
