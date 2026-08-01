import { clearSearchCache } from '../components/GameSearch';
import { api } from './api';
import { localDb } from './localDb';

const activeFlushes = new Map<string, Promise<number>>();

const sameDraftAsSubmission = (
  draft: Awaited<ReturnType<typeof localDb.getDraft>>,
  gameId: string,
  statements: string[],
) => draft?.game?.id === gameId
  && draft.rules.filter((rule) => rule.statement.trim()).map((rule) => rule.statement.trim()).join('\n')
    === statements.map((statement) => statement.trim()).join('\n');

export const flushPendingSubmissions = (userId: string): Promise<number> => {
  const current = activeFlushes.get(userId);
  if (current) return current;
  const request = (async () => {
    const pendingItems = await localDb.getPending(userId);
    let synchronized = 0;
    for (const item of pendingItems) {
      try {
        await api.submit(item.payload);
        await localDb.removePending(item.id);
        const draft = await localDb.getDraft();
        if (sameDraftAsSubmission(
          draft,
          item.payload.gameId ?? '',
          item.payload.rules.map((rule) => rule.statement),
        )) await localDb.clearDraft();
        await Promise.all([
          item.payload.gameId ? localDb.invalidateGame(item.payload.gameId) : Promise.resolve(),
          localDb.invalidateHome(),
        ]);
        synchronized += 1;
      } catch {
        // Keep failed items for a later online/login event; continue with independent submissions.
      }
    }
    if (synchronized) clearSearchCache();
    return synchronized;
  })().finally(() => { activeFlushes.delete(userId); });
  activeFlushes.set(userId, request);
  return request;
};
