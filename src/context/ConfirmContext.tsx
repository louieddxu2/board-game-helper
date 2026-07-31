import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { ConfirmDialog, type ConfirmDialogOptions } from '../components/ConfirmDialog';

export type ConfirmResult = boolean | 'discard';

interface ConfirmState {
  confirm(options: ConfirmDialogOptions): Promise<ConfirmResult>;
}

export const ConfirmContext = createContext<ConfirmState | null>(null);

export const ConfirmProvider = ({ children }: PropsWithChildren) => {
  const [dialog, setDialog] = useState<ConfirmDialogOptions>();
  const resolver = useRef<((result: ConfirmResult) => void) | undefined>(undefined);

  const finish = useCallback((result: ConfirmResult) => {
    resolver.current?.(result);
    resolver.current = undefined;
    setDialog(undefined);
  }, []);

  const confirm = useCallback((options: ConfirmDialogOptions) => new Promise<ConfirmResult>((resolve) => {
    resolver.current?.(false);
    resolver.current = resolve;
    setDialog(options);
  }), []);

  useEffect(() => () => { resolver.current?.(false); }, []);

  return <ConfirmContext.Provider value={{ confirm }}>
    {children}
    <ConfirmDialog open={Boolean(dialog)} title={dialog?.title ?? ''} message={dialog?.message ?? ''}
      confirmLabel={dialog?.confirmLabel} cancelLabel={dialog?.cancelLabel} discardLabel={dialog?.discardLabel} tone={dialog?.tone}
      onConfirm={() => finish(true)} onCancel={() => finish(false)} onDiscard={() => finish('discard')} />
  </ConfirmContext.Provider>;
};

export const useConfirm = () => {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error('ConfirmProvider is missing');
  return context;
};
