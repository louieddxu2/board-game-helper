import { useEffect, useId, useRef } from 'react';

interface TextInputDialogProps {
  open: boolean;
  title: string;
  label: string;
  value: string;
  confirmLabel?: string;
  maxLength?: number;
  onChange(value: string): void;
  onSubmit(): void;
  onCancel(): void;
}

export const TextInputDialog = ({ open, title, label, value, confirmLabel = '新增', maxLength, onChange, onSubmit, onCancel }: TextInputDialogProps) => {
  const titleId = useId();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
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
  }, [onCancel, open]);

  if (!open) return null;
  return <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <form className="modal text-input-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}
      onSubmit={(event) => { event.preventDefault(); if (value.trim()) onSubmit(); }}>
      <div className="confirm-dialog-copy"><h2 id={titleId}>{title}</h2></div>
      <label htmlFor={inputId}>{label}</label>
      <input ref={inputRef} id={inputId} value={value} maxLength={maxLength} autoComplete="off"
        onChange={(event) => onChange(event.target.value)} />
      <div className="confirm-dialog-actions">
        <button type="button" className="button secondary" onClick={onCancel}>取消</button>
        <button type="submit" className="button primary" disabled={!value.trim()}>{confirmLabel}</button>
      </div>
    </form>
  </div>;
};
