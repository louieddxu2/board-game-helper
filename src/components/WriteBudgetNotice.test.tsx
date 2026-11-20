import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { SessionContext } from '../context/SessionContext';
import { announceWriteBudgetExhausted, type WriteBudgetStatus } from '../lib/writeBudget';
import { WriteBudgetNotice } from './WriteBudgetNotice';

const resetsAt = Date.parse('2026-11-21T00:00:00.000Z');
const budget = (used: number, exhaustedAt: number | null = null): WriteBudgetStatus => ({
  day: '2026-11-20', used, limit: 50_000, exhaustedAt, resetsAt,
});

const renderNotice = (session: { realIsAdmin: boolean; writeBudget: WriteBudgetStatus | null }) => render(
  <SessionContext.Provider value={session as never}><WriteBudgetNotice /></SessionContext.Provider>,
);

describe('daily write budget notice', () => {
  afterEach(cleanup);

  test('tells anyone whose write was refused that reading still works', () => {
    renderNotice({ realIsAdmin: false, writeBudget: null });
    expect(screen.queryByRole('status')).toBeNull();
    act(() => announceWriteBudgetExhausted(resetsAt));
    expect(screen.getByRole('status')).toHaveTextContent('今日網站的記錄額度已用完，11/21 08:00 恢復。閱讀不受影響');
    fireEvent.click(screen.getByRole('button', { name: '知道了' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  test('warns admins on load from 80% of the shared budget and when it is spent', () => {
    const { rerender } = renderNotice({ realIsAdmin: true, writeBudget: budget(39_999) });
    expect(screen.queryByRole('alert')).toBeNull();
    const show = (writeBudget: WriteBudgetStatus) => rerender(
      <SessionContext.Provider value={{ realIsAdmin: true, writeBudget } as never}><WriteBudgetNotice /></SessionContext.Provider>,
    );
    show(budget(40_000));
    expect(screen.getByRole('alert')).toHaveTextContent('今日共用寫入額度即將用完');
    expect(screen.getByRole('alert')).toHaveTextContent('40,000 / 50,000 列（80%）');
    show(budget(50_120, Date.parse('2026-11-20T05:30:00.000Z')));
    expect(screen.getByRole('alert')).toHaveTextContent('今日共用寫入額度已用完');
    expect(screen.getByRole('alert')).toHaveTextContent('已於 11/20 13:30 起暫停記錄');
    expect(screen.getByRole('alert')).toHaveTextContent('額度於 11/21 08:00 重置');
  });

  test('never shows the admin warning to other users', () => {
    renderNotice({ realIsAdmin: false, writeBudget: budget(50_000, 1) });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
