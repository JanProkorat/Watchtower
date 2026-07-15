import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Snackbar } from '@mui/material';

type Severity = 'error' | 'success' | 'info' | 'warning';

interface ToastState {
  message: string;
  severity: Severity;
  key: number;
}

interface ToastApi {
  showError(message: string): void;
  showSuccess(message: string): void;
  showInfo(message: string): void;
  showWarning(message: string): void;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Module-level bridge so non-React code — chiefly the global IPC `invoke`
 * wrapper in `state/ipc.ts` — can raise toasts. `ToastProvider` registers its
 * live api here on mount; before that (and after unmount) every call is a no-op.
 */
let registered: ToastApi | null = null;
export const toast: ToastApi = {
  showError: (m) => registered?.showError(m),
  showSuccess: (m) => registered?.showSuccess(m),
  showInfo: (m) => registered?.showInfo(m),
  showWarning: (m) => registered?.showWarning(m),
};

/**
 * App-wide toast surface. Every error/warning in the desktop renderer flows
 * through here — IPC failures via the `invoke` wrapper, structured `warnings`
 * from list payloads, and fire-and-forget action failures. Toasts are queued
 * (FIFO) so a burst of failures doesn't clobber one another.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<ToastState[]>([]);
  const current = queue[0] ?? null;

  const push = useCallback((message: string, severity: Severity) => {
    setQueue((q) => [...q, { message, severity, key: Date.now() + q.length }]);
  }, []);

  const dismiss = useCallback(() => setQueue((q) => q.slice(1)), []);

  const api = useMemo<ToastApi>(
    () => ({
      showError: (message) => push(message, 'error'),
      showSuccess: (message) => push(message, 'success'),
      showInfo: (message) => push(message, 'info'),
      showWarning: (message) => push(message, 'warning'),
    }),
    [push],
  );

  // Expose this provider's api to the module-level bridge for non-React callers.
  useEffect(() => {
    registered = api;
    return () => { registered = null; };
  }, [api]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Snackbar
        key={current?.key ?? 'none'}
        open={Boolean(current)}
        autoHideDuration={current?.severity === 'error' ? 8000 : 4000}
        onClose={(_, reason) => {
          if (reason === 'clickaway') return;
          dismiss();
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {current ? (
          <Alert
            severity={current.severity}
            variant="filled"
            onClose={dismiss}
            sx={{ maxWidth: 720 }}
          >
            {current.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be called inside a ToastProvider');
  }
  return ctx;
}

/** Convenience: extract a human-readable message from an unknown error. */
export function toastMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
