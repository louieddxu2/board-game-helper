import { openDB, type DBSchema } from 'idb';
import { emptyWorkspace, normalizeWorkspace } from './model';
import type { WorkspaceData } from './types';

interface WorkspaceDb extends DBSchema {
  state: { key: string; value: WorkspaceData };
}

const DATABASE_NAME = 'board-game-helper-workspace';
const STATE_KEY = 'workspace';

const database = typeof indexedDB === 'undefined'
  ? null
  : openDB<WorkspaceDb>(DATABASE_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('state')) db.createObjectStore('state');
    },
  });

export const loadWorkspace = async (): Promise<WorkspaceData> => {
  if (!database) return emptyWorkspace();
  const loaded = (await (await database).get('state', STATE_KEY)) ?? emptyWorkspace();
  return normalizeWorkspace(loaded);
};

export const saveWorkspace = async (data: WorkspaceData) => {
  if (!database) return;
  await (await database).put('state', data, STATE_KEY);
};

export const clearWorkspace = async () => {
  if (!database) return;
  await (await database).delete('state', STATE_KEY);
};
