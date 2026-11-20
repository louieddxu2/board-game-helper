import type { Database } from './database';

// Visitors and members other than editors and admins share one daily budget of
// D1 rows written, so a script cannot spend the free plan's 100,000 daily
// writes. The other 20,000 rows stay for editors, admins and scheduled work,
// including a full weekly attribute replay. Reading is never limited. The day
// follows D1's quota reset (UTC).
export const DAILY_SHARED_WRITE_LIMIT = 80_000;
export const WRITE_BUDGET_WARNING_RATIO = 0.8;
export const WRITE_BUDGET_EXHAUSTED = 'daily_write_budget_exhausted';

export interface WriteBudgetStatus {
  day: string;
  used: number;
  limit: number;
  exhaustedAt: number | null;
  resetsAt: number;
}

export const writeBudgetDay = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);
const nextReset = (timestamp: number) => Date.parse(`${writeBudgetDay(timestamp)}T00:00:00.000Z`) + 86_400_000;

// Once this isolate sees the day's budget spent, later rejections read nothing.
let exhaustedDay: string | null = null;

export const resetWriteBudgetMemoryForTests = () => { exhaustedDay = null; };

export const isWriteBudgetExhausted = async (db: Database, timestamp = Date.now()): Promise<boolean> => {
  const day = writeBudgetDay(timestamp);
  if (exhaustedDay === day) return true;
  const row = await db.statement('SELECT rows_written FROM daily_write_budget WHERE day = ?')
    .bind(day).first<{ rows_written: number }>();
  if (Number(row?.rows_written ?? 0) < DAILY_SHARED_WRITE_LIMIT) return false;
  exhaustedDay = day;
  return true;
};

export const chargeWriteBudget = async (db: Database, rowsWritten: number, timestamp = Date.now()): Promise<void> => {
  if (!(rowsWritten > 0)) return;
  const day = writeBudgetDay(timestamp);
  const row = await db.statement(`
    INSERT INTO daily_write_budget (day, rows_written, exhausted_at)
    VALUES (?1, ?2, CASE WHEN ?2 >= ?3 THEN ?4 END)
    ON CONFLICT(day) DO UPDATE SET
      rows_written = daily_write_budget.rows_written + excluded.rows_written,
      exhausted_at = COALESCE(daily_write_budget.exhausted_at,
        CASE WHEN daily_write_budget.rows_written + excluded.rows_written >= ?3 THEN ?4 END)
    RETURNING rows_written
  `).bind(day, Math.ceil(rowsWritten), DAILY_SHARED_WRITE_LIMIT, timestamp).first<{ rows_written: number }>();
  if (Number(row?.rows_written ?? 0) >= DAILY_SHARED_WRITE_LIMIT) exhaustedDay = day;
};

export const queryWriteBudgetStatus = async (db: Database, timestamp = Date.now()): Promise<WriteBudgetStatus> => {
  const day = writeBudgetDay(timestamp);
  const row = await db.statement('SELECT rows_written, exhausted_at FROM daily_write_budget WHERE day = ?')
    .bind(day).first<{ rows_written: number; exhausted_at: number | null }>();
  return {
    day,
    used: Number(row?.rows_written ?? 0),
    limit: DAILY_SHARED_WRITE_LIMIT,
    exhaustedAt: row?.exhausted_at == null ? null : Number(row.exhausted_at),
    resetsAt: nextReset(timestamp),
  };
};

export const writeBudgetExhaustedPayload = (timestamp = Date.now()) => ({
  error: WRITE_BUDGET_EXHAUSTED,
  resetsAt: nextReset(timestamp),
});
