import { openDB, type DBSchema } from 'idb';
import type { GameDetail, HomePayload, SubmissionInput } from '../shared/types';

export interface DraftRecord {
  id: string;
  game?: { id: string; slug: string; displayName: string };
  gameQuery: string;
  rules: Array<{ id: string; statement: string; commonMistake?: string }>;
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
  recentGames: { key: string; value: { id: string; slug: string; displayName: string; viewedAt: number }; indexes: { viewedAt: number } };
}

const database = openDB<RulesDb>('wrong-board-game-rules', 1, {
  upgrade(db) {
    db.createObjectStore('drafts', { keyPath: 'id' });
    db.createObjectStore('pending', { keyPath: 'id' });
    db.createObjectStore('cache', { keyPath: 'key' });
    const recent = db.createObjectStore('recentGames', { keyPath: 'id' });
    recent.createIndex('viewedAt', 'viewedAt');
  },
});

export const localDb = {
  getDraft: async () => (await database).get('drafts', 'active'),
  saveDraft: async (draft: Omit<DraftRecord, 'id'>) => (await database).put('drafts', { ...draft, id: 'active' }),
  clearDraft: async () => (await database).delete('drafts', 'active'),
  addPending: async (payload: SubmissionInput) => (await database).put('pending', { id: payload.idempotencyKey, payload, createdAt: Date.now() }),
  removePending: async (id: string) => (await database).delete('pending', id),
  getPending: async () => (await database).getAll('pending'),
  cacheHome: async (data: HomePayload) => (await database).put('cache', { key: 'home', data, cachedAt: Date.now() }),
  getCachedHome: async () => (await database).get('cache', 'home') as Promise<{ key: string; data: HomePayload; cachedAt: number } | undefined>,
  cacheGame: async (game: GameDetail) => {
    const db = await database;
    await db.put('cache', { key: `game:${game.slug}`, data: game, cachedAt: Date.now() });
    await db.put('recentGames', { id: game.id, slug: game.slug, displayName: game.displayName, viewedAt: Date.now() });
  },
  getCachedGame: async (slug: string) => (await database).get('cache', `game:${slug}`) as Promise<{ data: GameDetail } | undefined>,
  recentGames: async () => {
    const db = await database;
    const all = await db.getAllFromIndex('recentGames', 'viewedAt');
    return all.reverse().slice(0, 8);
  },
};

