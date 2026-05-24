import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
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
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Lightweight app-wide toast surface for surfacing IPC mutation failures
 * that would otherwise be silent. Reads succeed via inline Alerts on each
 * tab; this hook is for fire-and-forget actions (archive, delete, snooze,
 * launch) where there's no obvious place for an inline error.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);

  const push = useCallback((message: string, severity: Severity) => {
    setToast({ message, severity, key: Date.now() });
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      showError: (message) => push(message, 'error'),
      showSuccess: (message) => push(message, 'success'),
      showInfo: (message) => push(message, 'info'),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Snackbar
        key={toast?.key ?? 'none'}
        open={Boolean(toast)}
        autoHideDuration={toast?.severity === 'error' ? 8000 : 4000}
        onClose={(_, reason) => {
          if (reason === 'clickaway') return;
          setToast(null);
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast ? (
          <Alert
            severity={toast.severity}
            variant="filled"
            onClose={() => setToast(null)}
            sx={{ maxWidth: 720 }}
          >
            {toast.message}
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
