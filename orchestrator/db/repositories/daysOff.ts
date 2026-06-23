import type { SqliteLike } from '../migrations.js';
import { nowIso, newSyncId } from '../syncColumns.js';

export type DayOffKind = 'vacation' | 'sick' | 'other' | 'holiday';

export interface DayOffRow {
  date: string; // YYYY-MM-DD
  kind: DayOffKind;
  note: string | null;
  createdAt: string;
}

export interface DayOffInput {
  date: string;
  kind: DayOffKind;
  note?: string | null;
}

type DbRow = {
  date: string;
  kind: DayOffKind;
  note: string | null;
  created_at: string;
};

function toRow(r: DbRow): DayOffRow {
  return { date: r.date, kind: r.kind, note: r.note, createdAt: r.created_at };
}

/**
 * Global user-marked time off, separate from project. Czech public holidays
 * are *not* stored here — they come from the `workdays` helper. The 'holiday'
 * kind exists for users who want to mark non-Czech public holidays manually
 * (e.g. a foreign client's Independence Day) without polluting the work
 * project's worklogs.
 */
export class DaysOffRepo {
  constructor(private db: SqliteLike) {}

  /** Returns all rows, sorted by date ascending. */
  listAll(): DayOffRow[] {
    return (
      this.db
        .prepare(
          `SELECT date, kind, note, created_at FROM days_off WHERE deleted_at IS NULL ORDER BY date ASC`,
        )
        .all() as DbRow[]
    ).map(toRow);
  }

  /** Returns rows inside [from, to] inclusive, sorted by date ascending. */
  listInRange(from: string, to: string): DayOffRow[] {
    return (
      this.db
        .prepare(
          `SELECT date, kind, note, created_at FROM days_off
            WHERE date >= ? AND date <= ? AND deleted_at IS NULL
            ORDER BY date ASC`,
        )
        .all(from, to) as DbRow[]
    ).map(toRow);
  }

  /** Returns the row for a single date, or null if not marked. */
  get(date: string): DayOffRow | null {
    const row = this.db
      .prepare(`SELECT date, kind, note, created_at FROM days_off WHERE date = ? AND deleted_at IS NULL`)
      .get(date) as DbRow | undefined;
    return row ? toRow(row) : null;
  }

  /**
   * INSERT-OR-REPLACE — the primary key is the date itself so toggling the
   * same date to a new kind is a single statement. The `note` defaults to
   * preserving the existing one when the new payload omits it; pass an
   * empty string to clear it.
   */
  upsert(input: DayOffInput): DayOffRow {
    const existing = this.getIncludingDeleted(input.date);
    const note = input.note === undefined ? existing?.note ?? null : input.note;
    const syncId = existing?.sync_id ?? newSyncId();
    this.db
      .prepare(
        `INSERT INTO days_off (date, kind, note, sync_id, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, NULL)
         ON CONFLICT(date) DO UPDATE SET
           kind = excluded.kind, note = excluded.note,
           updated_at = excluded.updated_at, deleted_at = NULL`,
      )
      .run(input.date, input.kind, note, syncId, nowIso());
    return this.get(input.date)!;
  }

  private getIncludingDeleted(date: string): { note: string | null; sync_id: string } | null {
    const row = this.db.prepare(`SELECT note, sync_id FROM days_off WHERE date = ?`).get(date) as
      | { note: string | null; sync_id: string }
      | undefined;
    return row ?? null;
  }

  delete(date: string): void {
    const ts = nowIso();
    this.db.prepare(`UPDATE days_off SET deleted_at = ?, updated_at = ? WHERE date = ?`).run(ts, ts, date);
  }
}
