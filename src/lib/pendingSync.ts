import { clearSearchCache } from '../components/GameSearch';
import { api } from './api';
import { localDb } from './localDb';

let activeFlush: Promise<number> | undefined;

const sameDraftAsSubmission = (
  draft: Awaited<ReturnType<typeof localDb.getDraft>>,
  gameId: string,
  statements: string[],
) => draft?.game?.id === gameId
  && draft.rules.filter((rule) => rule.statement.trim()).map((rule) => rule.statement.trim()).join('\n')
    === statements.map((statement) => statement.trim()).join('\n');

export const flushPendingSubmissions = (): Promise<number> => {
  if (activeFlush) return activeFlush;
  activeFlush = (async () => {
    const pendingItems = await localDb.getPending();
    let synchronized = 0;
    for (const item of pendingItems) {
      try {
        await api.submit(item.payload);
        await localDb.removePending(item.id);
        const draft = await localDb.getDraft();
        if (sameDraftAsSubmission(
          draft,
          item.payload.gameId,
          item.payload.rules.map((rule) => rule.statement),
        )) await localDb.clearDraft();
        await Promise.all([
          localDb.invalidateGame(item.payload.gameId),
          localDb.invalidateHome(),
        ]);
        synchronized += 1;
      } catch {
        // Keep failed items for a later online/login event; continue with independent submissions.
      }
    }
    if (synchronized) clearSearchCache();
    return synchronized;
  })().finally(() => { activeFlush = undefined; });
  return activeFlush;
};
