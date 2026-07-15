import { useCallback, useEffect, useState } from 'react';
import type {
  DayOffInputPayload,
  DayOffViewPayload,
  PublicHolidayPayload,
} from '@watchtower/shared/ipcContract.js';
import { invoke } from './ipc';

export interface DaysOffState {
  days: DayOffViewPayload[];
  /** YYYY-MM-DD → DayOffViewPayload for fast cell lookups. */
  byDate: Map<string, DayOffViewPayload>;
  /** Czech public holidays loaded for the focus year ± 1. */
  holidays: PublicHolidayPayload[];
  holidaysByDate: Map<string, PublicHolidayPayload>;
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
  upsert(input: DayOffInputPayload): Promise<DayOffViewPayload>;
  remove(date: string): Promise<void>;
}

/**
 * Loads every user-marked day off plus the Czech public-holiday list for a
 * window around the focus year. Holidays come from the server-side helper so
 * the client never has to know about the Easter algorithm.
 */
export function useDaysOff(focusYear: number): DaysOffState {
  const [days, setDays] = useState<DayOffViewPayload[]>([]);
  const [holidays, setHolidays] = useState<PublicHolidayPayload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [allDays, prevY, thisY, nextY] = await Promise.all([
        invoke('daysOff:list', {}),
        invoke('holidays:list', { year: focusYear - 1 }),
        invoke('holidays:list', { year: focusYear }),
        invoke('holidays:list', { year: focusYear + 1 }),
      ]);
      setDays(allDays.daysOff);
      setHolidays([...prevY.holidays, ...thisY.holidays, ...nextY.holidays]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [focusYear]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upsert = useCallback(
    async (input: DayOffInputPayload) => {
      const res = await invoke('daysOff:upsert', input);
      await refresh();
      return res.dayOff;
    },
    [refresh],
  );

  const remove = useCallback(
    async (date: string) => {
      await invoke('daysOff:delete', { date });
      await refresh();
    },
    [refresh],
  );

  const byDate = new Map(days.map((d) => [d.date, d] as const));
  const holidaysByDate = new Map(holidays.map((h) => [h.date, h] as const));

  return {
    days,
    byDate,
    holidays,
    holidaysByDate,
    loading,
    error,
    refresh,
    upsert,
    remove,
  };
}
