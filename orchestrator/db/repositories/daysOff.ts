import type { SqliteLike } from '../migrations.js';

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
          `SELECT date, kind, note, created_at FROM days_off ORDER BY date ASC`,
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
            WHERE date >= ? AND date <= ?
            ORDER BY date ASC`,
        )
        .all(from, to) as DbRow[]
    ).map(toRow);
  }

  /** Returns the row for a single date, or null if not marked. */
  get(date: string): DayOffRow | null {
    const row = this.db
      .prepare(`SELECT date, kind, note, created_at FROM days_off WHERE date = ?`)
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
    // Preserve existing note unless caller specified one (including null/empty).
    const note =
      input.note === undefined ? this.get(input.date)?.note ?? null : input.note;
    this.db
      .prepare(
        `INSERT INTO days_off (date, kind, note) VALUES (?, ?, ?)
         ON CONFLICT(date) DO UPDATE SET kind = excluded.kind, note = excluded.note`,
      )
      .run(input.date, input.kind, note);
    return this.get(input.date)!;
  }

  delete(date: string): void {
    this.db.prepare(`DELETE FROM days_off WHERE date = ?`).run(date);
  }
}
