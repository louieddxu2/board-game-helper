import { openDB, type DBSchema } from 'idb';
import type { GameDetail, HomeIDPayload, HomePayload, SubmissionInput } from '../shared/types';

export interface DraftRecord {
  id: string;
  game?: { id: string; slug: string; displayName: string };
  gameQuery: string;
  rules: Array<{ id: string; statement: string; commonMistake?: string; tagNames?: string[] }>;
  sourceLabel: string;
  sourceUrl: string;
  playedOn: string;
  privateNote: string;
  updatedAt: number;
}

interface RulesDb extends DBSchema {
  drafts: { key: string; value: DraftRecord };
  pending: { key: string; value: { id: string; payload: SubmissionInput; createdAt: number } };
  cache: { key: string; value: { key: string; data: unknown; cachedAt: number } };
  recentGames: { key: string; value: { id: string; viewedAt: number }; indexes: { viewedAt: number } };
}

const getDb = () => {
  if (typeof indexedDB === 'undefined') return null;
  return openDB<RulesDb>('wrong-board-game-rules', 1, {
    upgrade(db) {
      db.createObjectStore('drafts', { keyPath: 'id' });
      db.createObjectStore('pending', { keyPath: 'id' });
      db.createObjectStore('cache', { keyPath: 'key' });
      const recent = db.createObjectStore('recentGames', { keyPath: 'id' });
      recent.createIndex('viewedAt', 'viewedAt');
    },
  });
};

let dbPromise: ReturnType<typeof getDb> | null = null;
const getDatabase = async () => {
  if (!dbPromise) dbPromise = getDb();
  const db = await dbPromise;
  if (!db) throw new Error('IndexedDB not available');
  return db;
};

const notifyPending = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('rules-pending-change'));
  }
};

export const localDb = {
  getDraft: async () => (await getDatabase()).get('drafts', 'active'),
  saveDraft: async (draft: Omit<DraftRecord, 'id'>) => (await getDatabase()).put('drafts', { ...draft, id: 'active' }),
  clearDraft: async () => (await getDatabase()).delete('drafts', 'active'),
  addPending: async (payload: SubmissionInput) => { const result = await (await getDatabase()).put('pending', { id: payload.idempotencyKey, payload, createdAt: Date.now() }); notifyPending(); return result; },
  removePending: async (id: string) => { await (await getDatabase()).delete('pending', id); notifyPending(); },
  getPending: async () => (await getDatabase()).getAll('pending'),
  cacheHome: async (data: HomePayload) => (await getDatabase()).put('cache', { key: 'home', data, cachedAt: Date.now() }),
  getCachedHome: async () => (await getDatabase()).get('cache', 'home') as Promise<{ key: string; data: HomePayload; cachedAt: number } | undefined>,
  cacheHomeIDs: async (data: HomeIDPayload) => (await getDatabase()).put('cache', { key: 'home_ids', data, cachedAt: Date.now() }),
  getCachedHomeIDs: async () => (await getDatabase()).get('cache', 'home_ids') as Promise<{ key: string; data: HomeIDPayload; cachedAt: number } | undefined>,
  invalidateHome: async () => {
    const db = await getDatabase();
    await db.delete('cache', 'home');
    await db.delete('cache', 'home_ids');
  },
  cacheGame: async (game: GameDetail) => {
    const db = await getDatabase();
    await db.put('cache', { key: `game:${game.slug}`, data: game, cachedAt: Date.now() });
    await db.put('recentGames', { id: game.id, viewedAt: Date.now() });
  },
  getCachedGame: async (slug: string) => (await getDatabase()).get('cache', `game:${slug}`) as Promise<{ key: string; data: GameDetail; cachedAt: number } | undefined>,
  invalidateGame: async (slug: string) => (await getDatabase()).delete('cache', `game:${slug}`),
  recentGameIds: async () => {
    const db = await getDatabase();
    const all = await db.getAllFromIndex('recentGames', 'viewedAt');
    return all.reverse().slice(0, 8).map((r) => r.id);
  },
  recentGames: async () => {
    const db = await getDatabase();
    const all = await db.getAllFromIndex('recentGames', 'viewedAt');
    const recentRecords = all.reverse().slice(0, 8);
    const resolved = await Promise.all(
      recentRecords.map(async (r) => {
        const cached = (await db.get('cache', `game:${r.id}`)) as { data: GameDetail } | undefined;
        if (cached?.data) {
          return { id: r.id, slug: cached.data.slug, displayName: cached.data.displayName };
        }
        return null;
      })
    );
    return resolved.filter(Boolean) as Array<{ id: string; slug: string; displayName: string }>;
  },
  clearAllCache: async () => (await getDatabase()).clear('cache'),
};
