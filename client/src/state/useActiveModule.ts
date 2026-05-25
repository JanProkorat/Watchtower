import { useCallback, useState } from 'react';
import type { ModuleId } from '../components/ModuleRail.js';

const STORAGE_KEY = 'watchtower.activeModule';
const VALID: ReadonlySet<ModuleId> = new Set(['dashboard', 'instances', 'timetracker', 'settings']);

export const DEFAULT_ACTIVE_MODULE: ModuleId = 'dashboard';

export function readActiveModule(): ModuleId {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && VALID.has(v as ModuleId)) return v as ModuleId;
  } catch {
    /* localStorage unavailable — fall through to default */
  }
  return DEFAULT_ACTIVE_MODULE;
}

export function writeActiveModule(id: ModuleId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* best-effort persistence — same pattern as useInstances */
  }
}

export function useActiveModule(): [ModuleId, (m: ModuleId) => void] {
  const [active, setActive] = useState<ModuleId>(readActiveModule);
  const set = useCallback((next: ModuleId) => {
    writeActiveModule(next);
    setActive(next);
  }, []);
  return [active, set];
}
