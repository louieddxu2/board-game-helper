import { beforeEach, expect, test, vi } from 'vitest';
import { localDbEdits } from './localDbEdits';

const mocks = vi.hoisted(() => ({ getDatabase: vi.fn() }));
vi.mock('./localDbCore', () => ({ getDatabase: mocks.getDatabase, notifyPending: vi.fn() }));
beforeEach(() => mocks.getDatabase.mockReset());
const draft = { gameQuery: '船廠', updatedAt: 1, rules: [{ id: 'r1', statement: '舊稿' }] };

test('finishes an in-flight draft write before deletion and subsequent reads', async () => {
  let stored: unknown;
  let finishWrite!: () => void;
  const put = vi.fn(() => new Promise<void>(resolve => { finishWrite = () => { stored = draft; resolve(); }; }));
  const remove = vi.fn(async () => { stored = undefined; });
  mocks.getDatabase.mockResolvedValue({ put, delete: remove, get: async () => stored });
  const write = localDbEdits.saveDraft(draft);
  const clear = localDbEdits.clearDraft();
  const read = localDbEdits.getDraft();
  await vi.waitFor(() => expect(put).toHaveBeenCalledOnce());
  expect(remove).not.toHaveBeenCalled();
  finishWrite();
  await Promise.all([write, clear]);
  expect(await read).toBeUndefined();
  expect(remove).toHaveBeenCalledOnce();
});

test('a failed write does not block saving and reading a later draft', async () => {
  let stored: unknown;
  const put = vi.fn().mockRejectedValueOnce(new Error('quota exceeded')).mockImplementation(async (_store, value) => { stored = value; });
  mocks.getDatabase.mockResolvedValue({ put, get: async () => stored });
  await expect(localDbEdits.saveDraft(draft)).rejects.toThrow('quota exceeded');
  await localDbEdits.saveDraft({ ...draft, gameQuery: '另一款遊戲' });
  expect(await localDbEdits.getDraft()).toMatchObject({ gameQuery: '另一款遊戲' });
});
