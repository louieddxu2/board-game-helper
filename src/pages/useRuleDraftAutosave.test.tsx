// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useRuleDraftAutosave } from './useRuleDraftAutosave';
const mocks = vi.hoisted(() => ({ saveDraft: vi.fn(), clearDraft: vi.fn() }));
vi.mock('../lib/localDb', () => ({ localDb: mocks }));
afterEach(() => { cleanup(); vi.useRealTimers(); mocks.saveDraft.mockReset(); mocks.clearDraft.mockReset(); });
const draft = { gameQuery: '船廠', rules: [{ id: 'rule-1', statement: '第一版' }], updatedAt: 1 };

test('a late save of older content cannot mark the newer draft as saved', async () => {
  vi.useFakeTimers();
  let finishFirst!: () => void;
  mocks.saveDraft.mockImplementationOnce(() => new Promise<void>(resolve => { finishFirst = resolve; })).mockResolvedValue(undefined);
  const { result, rerender } = renderHook(({ value }) => useRuleDraftAutosave(value, true), { initialProps: { value: draft } });
  await act(async () => { await vi.advanceTimersByTimeAsync(251); });
  rerender({ value: { ...draft, updatedAt: 2, rules: [{ id: 'rule-1', statement: '第二版尚未儲存' }] } });
  await act(async () => { finishFirst(); });
  expect(result.current.status).toBe('saving');
  await act(async () => { await vi.advanceTimersByTimeAsync(251); });
  expect(result.current.status).toBe('saved');
  expect(mocks.saveDraft).toHaveBeenLastCalledWith(expect.objectContaining({ updatedAt: 2 }));
});

test('a quick route change still saves edits pending in the debounce window', () => {
  mocks.saveDraft.mockResolvedValue(undefined);
  const { unmount } = renderHook(() => useRuleDraftAutosave(draft, true));
  unmount();
  expect(mocks.saveDraft).toHaveBeenCalledOnce();
  expect(mocks.saveDraft).toHaveBeenCalledWith(draft);
});
