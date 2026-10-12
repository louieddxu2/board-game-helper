import { useEffect, useId, useRef } from 'react';
import { useWorkspaceBrowserBack } from '../workspace/useWorkspaceBrowserBack';

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  discardLabel?: string;
  tone?: 'default' | 'danger';
}

interface ConfirmDialogProps extends ConfirmDialogOptions {
  open: boolean;
  onConfirm(): void;
  onCancel(): void;
  onDiscard?(): void;
}

export const ConfirmDialog = ({ open, title, message, confirmLabel = '確定', cancelLabel = '取消', discardLabel, tone = 'default', onConfirm, onCancel, onDiscard }: ConfirmDialogProps) => {
  const titleId = useId();
  const messageId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  useWorkspaceBrowserBack({ active: open, onBack: onCancel });

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener('keydown', closeOnEscape, true);
    window.setTimeout(() => confirmRef.current?.focus(), 0);
    return () => {
      window.removeEventListener('keydown', closeOnEscape, true);
      previousFocus?.focus();
    };
  }, [onCancel, open]);

  if (!open) return null;
  return <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="modal confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId}>
      {discardLabel && onDiscard && <div className="confirm-dialog-top">
        <button type="button" className="confirm-discard-btn" onClick={onDiscard}>{discardLabel}</button>
      </div>}
      <div className="confirm-dialog-copy"><h2 id={titleId}>{title}</h2><p id={messageId}>{message}</p></div>
      <div className="confirm-dialog-actions">
        <button type="button" className="button secondary" onClick={onCancel}>{cancelLabel}</button>
        <button ref={confirmRef} type="button" className={tone === 'danger' ? 'button danger' : 'button primary'} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </section>
  </div>;
};
