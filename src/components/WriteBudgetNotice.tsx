import { useEffect, useState } from 'react';
import { useSession } from '../context/SessionContext';
import { formatTaipeiTime, WRITE_BUDGET_EXHAUSTED_EVENT, WRITE_BUDGET_WARNING_RATIO } from '../lib/writeBudget';

const count = (value: number) => value.toLocaleString('zh-TW');

/**
 * Explains a spent daily write budget to anyone whose write was refused, and
 * warns admins on page load once the shared budget nears or reaches its limit.
 */
export const WriteBudgetNotice = () => {
  const { realIsAdmin, writeBudget } = useSession();
  const [refusedUntil, setRefusedUntil] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const show = (event: Event) => {
      const resetsAt = (event as CustomEvent<{ resetsAt?: number }>).detail?.resetsAt;
      setRefusedUntil(typeof resetsAt === 'number' ? resetsAt : Date.now());
      setDismissed(false);
    };
    window.addEventListener(WRITE_BUDGET_EXHAUSTED_EVENT, show);
    return () => window.removeEventListener(WRITE_BUDGET_EXHAUSTED_EVENT, show);
  }, []);

  const adminWarning = realIsAdmin && writeBudget
    && (writeBudget.exhaustedAt !== null || writeBudget.used >= writeBudget.limit * WRITE_BUDGET_WARNING_RATIO);

  if (adminWarning && writeBudget) {
    const usage = `${count(writeBudget.used)} / ${count(writeBudget.limit)} 列`;
    return <div className="write-budget-notice is-admin" role="alert">
      <strong>{writeBudget.exhaustedAt !== null ? '今日共用寫入額度已用完' : '今日共用寫入額度即將用完'}</strong>
      <span>
        {writeBudget.exhaustedAt !== null
          ? `訪客與一般會員已於 ${formatTaipeiTime(writeBudget.exhaustedAt)} 起暫停記錄（${usage}），可能有大量異常寫入。`
          : `訪客與一般會員今日已寫入 ${usage}（${Math.floor((writeBudget.used / writeBudget.limit) * 100)}%），請確認是否有異常寫入。`}
        閱讀、編輯者與管理員不受影響；額度於 {formatTaipeiTime(writeBudget.resetsAt)} 重置。
      </span>
    </div>;
  }

  if (refusedUntil === null || dismissed) return null;
  return <div className="write-budget-notice" role="status">
    <span>今日網站的記錄額度已用完，{formatTaipeiTime(refusedUntil)} 恢復。閱讀不受影響，尚未送出的投票會保留在這台裝置上。</span>
    <button type="button" className="link-button" onClick={() => setDismissed(true)}>知道了</button>
  </div>;
};
