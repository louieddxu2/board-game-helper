interface PendingSnapshot { id: string }
const prefix = 'board-game-helper-drive-snapshot-pending:';

/** The local upload identity survives reloads until its backup record is acknowledged. */
export const createSnapshotJournal = (storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) => {
  const memory = new Map<string, PendingSnapshot>();
  const read = (account: string): PendingSnapshot | null => {
    try {
      const value = JSON.parse(storage?.getItem(prefix + account) ?? 'null');
      if (typeof value?.id === 'string') return { id: value.id };
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
