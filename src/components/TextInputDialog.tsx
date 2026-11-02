import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { useWorkspaceBrowserBack } from '../workspace/useWorkspaceBrowserBack';

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
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  useWorkspaceBrowserBack({ active: open, onBack: onCancel });

  // Focus within the opening tap (so mobile keyboards open) and only once per opening.
  useLayoutEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => previousFocus?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onCancelRef.current();
    };
    window.addEventListener('keydown', closeOnEscape, true);
    return () => window.removeEventListener('keydown', closeOnEscape, true);
  }, [open]);

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
