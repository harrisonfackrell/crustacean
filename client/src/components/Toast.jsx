import { createContext, useCallback, useContext, useRef, useState } from 'react';

const ToastContext = createContext(null);

// Lightweight toast system: useToast().notify(message, type)
// type: 'success' | 'error' | 'info' (default 'info')
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const notify = useCallback((message, type = 'info') => {
    const id = ++idRef.current;
    setToasts(prev => [...prev.slice(-4), { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div className="toast-container" aria-live="polite">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`toast ${t.type}`}
            onClick={() => dismiss(t.id)}
            title="Click to dismiss"
          >
            {t.type === 'success' ? '✓ ' : t.type === 'error' ? '✕ ' : 'ℹ '}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fall back to console if used outside the provider (e.g. during testing)
    return {
      notify: (message, type = 'info') => {
        const prefix = type === 'error' ? '[error] ' : type === 'success' ? '[ok] ' : '';
        console.log(prefix + message);
      }
    };
  }
  return ctx;
}
