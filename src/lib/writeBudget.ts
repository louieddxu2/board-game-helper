// The site's shared daily write budget (see worker/data/writeBudget.ts). Any
// write rejected because the budget is spent announces it once, so every page
// can explain why recording stopped while reading keeps working.
export const WRITE_BUDGET_EXHAUSTED = 'daily_write_budget_exhausted';
export const WRITE_BUDGET_EXHAUSTED_EVENT = 'site-write-budget-exhausted';
export const WRITE_BUDGET_WARNING_RATIO = 0.8;

export interface WriteBudgetStatus {
  day: string;
  used: number;
  limit: number;
  exhaustedAt: number | null;
  resetsAt: number;
}

export const announceWriteBudgetExhausted = (resetsAt?: number) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(WRITE_BUDGET_EXHAUSTED_EVENT, { detail: { resetsAt } }));
};

export const formatTaipeiTime = (timestamp: number) => new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(timestamp));
