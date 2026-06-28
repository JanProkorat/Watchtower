import { useState, useCallback } from 'react';
import { getSupabase } from '../lib/supabaseClient.js';
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
      const syncId = existing?.syncId ?? crypto.randomUUID();
      const now = new Date().toISOString();
      const row: DayOffRow = { date, kind, syncId };
      setError(null);
      setPending(date);
      patchDaysOff(applyDayOffWrite(prev, { type: 'set', row })); // optimistic
      try {
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
