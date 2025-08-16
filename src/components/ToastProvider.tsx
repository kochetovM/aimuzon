import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type ToastType = 'info' | 'success' | 'error';
export type Toast = {
  id: number;
  type: ToastType;
  message: string;
  timeout?: number;
};

type ToastContextValue = {
  notify: (message: string, opts?: { type?: ToastType; timeout?: number }) => void;
  info: (message: string, timeout?: number) => void;
  success: (message: string, timeout?: number) => void;
  error: (message: string, timeout?: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

let gid = 1;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((list) => list.filter(t => t.id !== id));
  }, []);

  const notify = useCallback((message: string, opts?: { type?: ToastType; timeout?: number }) => {
    const id = gid++;
    const type: ToastType = opts?.type || 'info';
    const timeout = typeof opts?.timeout === 'number' ? opts.timeout : 4000;
    setToasts((list) => [...list, { id, type, message, timeout }]);
    if (timeout && timeout > 0) {
      window.setTimeout(() => remove(id), timeout);
    }
  }, [remove]);

  const value = useMemo<ToastContextValue>(() => ({
    notify,
    info: (m, t) => notify(m, { type: 'info', timeout: t }),
    success: (m, t) => notify(m, { type: 'success', timeout: t }),
    error: (m, t) => notify(m, { type: 'error', timeout: t }),
  }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toast list container */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="fixed top-3 right-3 z-[100] flex flex-col gap-2 max-w-[92vw] sm:max-w-sm"
      >
        {toasts.map(t => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto rounded-md shadow-lg px-3 py-2 text-sm border ${
              t.type === 'error' ? 'bg-red-50 text-red-800 border-red-200' :
                t.type === 'success' ? 'bg-green-50 text-green-800 border-green-200' :
                  'bg-white text-gray-900 border-gray-200 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700'
            }`}
          >
            <div className="flex items-start gap-2">
              <div className="pt-0.5">
                {t.type === 'error' ? (
                  <span aria-hidden>⚠️</span>
                ) : t.type === 'success' ? (
                  <span aria-hidden>✅</span>
                ) : (
                  <span aria-hidden>ℹ️</span>
                )}
              </div>
              <div className="flex-1 whitespace-pre-line">{t.message}</div>
              <button
                className="ml-2 text-xs px-2 py-0.5 rounded border border-current/20 hover:bg-black/5"
                onClick={() => remove(t.id)}
                aria-label="Dismiss notification"
              >
                Close
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
