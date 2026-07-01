import { useState, useCallback } from 'react';
import { getSupabase } from './supabaseClient.js';
import type { DayOffRow } from '@watchtower/shared/billing/types.js';
import { buildDayOffUpsert, buildDayOffDelete, applyDayOffWrite } from './billingWrites.js';

interface Args {
  daysOff: DayOffRow[];
  patchDaysOff(next: DayOffRow[]): void;
}

export function useDaysOffMutations({ daysOff, patchDaysOff }: Args) {
  const [pending, setPending] = useState<string | null>(null); // date being written
  const [error, setError] = useState<string | null>(null);

  const setDayOff = useCallback(
    async (date: string, kind: string) => {
      const prev = daysOff;
      const existing = prev.find((d) => d.date === date);
      setError(null);
      setPending(date);
      try {
        // Resolve sync_id. Reuse the cached row's id for a visible date. Otherwise the
        // cache (non-deleted rows only) can't see a soft-deleted row for this date — so
        // look it up INCLUDING tombstones and preserve that id. Minting a fresh id for a
        // re-marked date would overwrite the row's sync_id on the date-PK upsert, and
        // since the Mac sync keys on sync_id, that wedges convergence on both push/pull.
        // Mint only when no row exists for the date at all.
        let syncId: string;
        if (existing?.syncId) {
          syncId = existing.syncId;
        } else {
          const { data: found, error: lookupErr } = await getSupabase()
            .from('days_off')
            .select('sync_id')
            .eq('date', date)
            .limit(1)
            .maybeSingle();
          if (lookupErr) throw lookupErr;
          syncId = (found?.sync_id as string | undefined) ?? crypto.randomUUID();
        }
        const now = new Date().toISOString();
        const row: DayOffRow = { date, kind, syncId };
        patchDaysOff(applyDayOffWrite(prev, { type: 'set', row })); // optimistic (sync_id resolved)
        const { error: e } = await getSupabase()
          .from('days_off')
          .upsert(buildDayOffUpsert(date, kind, { syncId, now }), { onConflict: 'date' });
        if (e) throw e;
      } catch (err) {
        patchDaysOff(prev); // rollback
        setError(err instanceof Error ? err.message : 'Uložení selhalo');
      } finally {
        setPending(null);
      }
    },
    [daysOff, patchDaysOff],
  );

  const clearDayOff = useCallback(
    async (date: string) => {
      const prev = daysOff;
      const now = new Date().toISOString();
      setError(null);
      setPending(date);
      patchDaysOff(applyDayOffWrite(prev, { type: 'clear', date })); // optimistic
      try {
        const { error: e } = await getSupabase()
          .from('days_off')
          .update(buildDayOffDelete(now))
          .eq('date', date);
        if (e) throw e;
      } catch (err) {
        patchDaysOff(prev); // rollback
        setError(err instanceof Error ? err.message : 'Smazání selhalo');
      } finally {
        setPending(null);
      }
    },
    [daysOff, patchDaysOff],
  );

  return { setDayOff, clearDayOff, pending, error };
}
