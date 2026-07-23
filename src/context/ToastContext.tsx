import { createContext, useCallback, useContext, useState, type PropsWithChildren } from 'react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastState {
  showToast(message: string, type?: ToastType): void;
}

const ToastContext = createContext<ToastState | null>(null);

let nextToastId = 0;

export const ToastProvider = ({ children }: PropsWithChildren) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = nextToastId++;
    setToasts((prev) => [...prev.slice(-2), { id, message, type }]); // 最多同時 3 則
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  return <ToastContext.Provider value={{ showToast }}>
    {children}
    {toasts.length > 0 && <div className="toast-container" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast-item toast-${toast.type}`} role="status">
          {toast.message}
          <button type="button" aria-label="關閉" onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}>×</button>
        </div>
      ))}
    </div>}
  </ToastContext.Provider>;
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('ToastProvider is missing');
  return context;
};
