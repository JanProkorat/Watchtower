import type { DayOffRow } from '@watchtower/shared/billing/types.js';
import type { BillingState } from './useBilling.js';

export interface DayOffUpsertRow {
  sync_id: string;
  date: string;
  kind: string;
  note: null;
  deleted_at: null;
  updated_at: string;
}

export function buildDayOffUpsert(
  date: string,
  kind: string,
  opts: { syncId: string; now: string },
): DayOffUpsertRow {
  return { sync_id: opts.syncId, date, kind, note: null, deleted_at: null, updated_at: opts.now };
}

export function buildDayOffDelete(now: string): { deleted_at: string; updated_at: string } {
  return { deleted_at: now, updated_at: now };
}

export type DayOffChange =
  | { type: 'set'; row: DayOffRow }
  | { type: 'clear'; date: string };

export function applyDayOffWrite(daysOff: DayOffRow[], change: DayOffChange): DayOffRow[] {
  if (change.type === 'clear') {
    return daysOff.filter((d) => d.date !== change.date);
  }
  const without = daysOff.filter((d) => d.date !== change.row.date);
  return [...without, change.row];
}

/** Online-direct: only a fresh (live) dataset is editable; offline/cached/loading is read-only. */
export function canEdit(state: BillingState): boolean {
  return state === 'fresh';
}
