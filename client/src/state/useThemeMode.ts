import { useCallback, useEffect, useState } from 'react';
import type { ThemeMode } from '../theme.js';

const STORAGE_KEY = 'watchtower:theme-mode';

function readInitial(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    // ignore — persistence is best-effort
  }
  return 'dark';
}

export function useThemeMode(): { mode: ThemeMode; toggle: () => void } {
  const [mode, setMode] = useState<ThemeMode>(readInitial);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // ignore — persistence is best-effort
    }
    // Mirror to <html data-theme=…> so the splash CSS vars in index.html
    // pick up the change without a reload.
    document.documentElement.setAttribute('data-theme', mode);
  }, [mode]);

  const toggle = useCallback(() => {
    setMode((m) => (m === 'dark' ? 'light' : 'dark'));
  }, []);

  return { mode, toggle };
}
