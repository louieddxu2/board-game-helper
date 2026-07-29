import { useEffect, useId, useRef, useState } from 'react';
import type { AccountDeletionSummary } from '../shared/types';

interface DeleteAccountDialogProps {
  open: boolean;
  summary?: AccountDeletionSummary;
  loading: boolean;
  busy: boolean;
  error?: string;
  onCancel(): void;
  onConfirm(deleteOwnUnmodifiedRules: boolean): void;
}

export const DeleteAccountDialog = ({
  open, summary, loading, busy, error, onCancel, onConfirm,
}: DeleteAccountDialogProps) => {
  const titleId = useId();
  const descriptionId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [deleteRules, setDeleteRules] = useState(false);
  const [confirmation, setConfirmation] = useState('');

  useEffect(() => {
    if (!open) return;
    setDeleteRules(false);
    setConfirmation('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener('keydown', closeOnEscape, true);
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      window.removeEventListener('keydown', closeOnEscape, true);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [busy, onCancel, open]);

  if (!open) return null;
  const blocked = Boolean(summary?.isLastAdmin);
  const canSubmit = !loading && !busy && !blocked && confirmation === '刪除帳號';

  return <div className="modal-backdrop" role="presentation" onPointerDown={(event) => {
    if (event.target === event.currentTarget && !busy) onCancel();
  }}>
    <section className="modal confirm-dialog delete-account-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
      <div className="confirm-dialog-copy">
        <h2 id={titleId}>永久刪除帳號</h2>
        <p id={descriptionId}>這會刪除登入、角色、收藏、投票及其他帳號資料，而且無法復原。</p>
        <p>若不勾選下方選項，只會去除帳號記錄；你建立或修改過的規則仍會保留於此平台資料庫，作者會改為「已刪除帳號」。</p>
      </div>

      {loading && <p className="muted" role="status">正在確認可刪除的規則…</p>}
      {summary && <label className="checkbox-row delete-account-rules" htmlFor="delete-own-rules">
        <input
          id="delete-own-rules"
          type="checkbox"
          checked={deleteRules}
          disabled={busy || summary.deletableRuleCount === 0}
          onChange={(event) => setDeleteRules(event.target.checked)}
        />
        也刪除僅由此帳號建立且無經他人修改過的規則（{summary.deletableRuleCount} 條）
      </label>}
      {summary && summary.retainedRuleCount > 0 && <p className="account-help">
        另有 {summary.retainedRuleCount} 條規則曾由其他人修改，為保留共同貢獻，不會刪除。
      </p>}
      {blocked && <p className="form-error" role="alert">這是目前最後一個管理員帳號。請先授予另一個帳號管理員權限，才能刪除。</p>}
      {error && <p className="form-error" role="alert">{error}</p>}

      <label htmlFor="delete-account-confirmation">
        請輸入「刪除帳號」確認
        <input
          ref={inputRef}
          id="delete-account-confirmation"
          value={confirmation}
          disabled={busy || blocked}
          autoComplete="off"
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </label>
      <div className="confirm-dialog-actions">
        <button type="button" className="button secondary" disabled={busy} onClick={onCancel}>取消</button>
        <button type="button" className="button danger" disabled={!canSubmit} onClick={() => onConfirm(deleteRules)}>
          {busy ? '刪除中…' : '永久刪除帳號'}
        </button>
      </div>
    </section>
  </div>;
};
