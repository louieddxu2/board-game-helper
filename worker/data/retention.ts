import type { Database } from './database';

export const cleanupExpiredSessions = async (db: Database, timestamp: number): Promise<void> => {
  await db.statement('DELETE FROM sessions WHERE expires_at <= ?').bind(timestamp).run();
};
