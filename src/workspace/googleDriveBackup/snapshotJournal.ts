interface PendingSnapshot { id: string; sourceRevision: string }
const prefix = 'board-game-helper-drive-snapshot-pending:';

/** This journal contains only operation/revision IDs. Acknowledge after saving the local receipt. */
export const createSnapshotJournal = (storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) => {
  const memory = new Map<string, PendingSnapshot>();
  const read = (account: string): PendingSnapshot | null => {
    try {
      const value = JSON.parse(storage?.getItem(prefix + account) ?? 'null');
      if (typeof value?.id === 'string' && typeof value.sourceRevision === 'string') return value;
    } catch { /* The in-memory journal also supports blocked browser storage. */ }
    return memory.get(account) ?? null;
  };
  return {
    read,
    write(account: string, value: PendingSnapshot) {
      memory.set(account, value);
      try { storage?.setItem(prefix + account, JSON.stringify(value)); } catch { /* Optional persistence. */ }
    },
    clear(account: string, id: string) {
      if (read(account)?.id !== id) return;
      memory.delete(account);
      try { storage?.removeItem(prefix + account); } catch { /* Optional persistence. */ }
    },
  };
};

export const snapshotRevisionDigest = async (revision: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(revision));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};
