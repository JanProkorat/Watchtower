import type { SqliteLike } from '../migrations.js';
import { nowIso, newSyncId } from '../syncColumns.js';

export type RateType = 'hourly' | 'daily';

export interface ProjectRateRow {
  id: number;
  projectId: number;
  effectiveFrom: string;
  rateType: RateType;
  rateAmount: number;
  hoursPerDay: number;
  endDate: string | null;
  mdLimit: number | null;
  createdAt: string;
}

export interface ProjectRateInput {
  projectId: number;
  effectiveFrom: string;
  rateType: RateType;
  rateAmount: number;
  hoursPerDay?: number;
  endDate?: string | null;
  mdLimit?: number | null;
}

type DbRow = {
  id: number;
  project_id: number;
  effective_from: string;
  rate_type: RateType;
  rate_amount: number;
  hours_per_day: number;
  end_date: string | null;
  md_limit: number | null;
  created_at: string;
};

function toRow(r: DbRow): ProjectRateRow {
  return {
    id: r.id,
    projectId: r.project_id,
    effectiveFrom: r.effective_from,
    rateType: r.rate_type,
    rateAmount: r.rate_amount,
    hoursPerDay: r.hours_per_day,
    endDate: r.end_date,
    mdLimit: r.md_limit,
    createdAt: r.created_at,
  };
}

export class RateOverlapError extends Error {
  constructor(public conflictingId: number, public conflictingFrom: string, public conflictingTo: string | null) {
    super(
      `Contract period overlaps with rate #${conflictingId} (${conflictingFrom} → ${
        conflictingTo ?? 'ongoing'
      }). Contracts on the same project must not overlap.`,
    );
    this.name = 'RateOverlapError';
  }
}

/**
 * Auto-close + overlap-rejection semantics:
 *
 *  - On create, any prior open-ended contract (end_date IS NULL) with
 *    effective_from < new.effective_from is auto-closed to
 *    end_date = new.effective_from - 1 day, inside the same transaction.
 *  - After auto-close, an overlap check runs. Any remaining overlap
 *    (e.g. someone created a contract with end_date in the middle of an
 *    existing closed range) throws RateOverlapError without writing.
 */
export class ProjectRatesRepo {
  constructor(private db: SqliteLike) {}

  listForProject(projectId: number): ProjectRateRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, project_id, effective_from, rate_type, rate_amount,
                hours_per_day, end_date, md_limit, created_at
           FROM contracts
          WHERE project_id = ?
            AND deleted_at IS NULL
          ORDER BY effective_from DESC, id DESC`,
      )
      .all(projectId) as DbRow[];
    return rows.map(toRow);
  }

  get(id: number): ProjectRateRow | null {
    const row = this.db
      .prepare(
        `SELECT id, project_id, effective_from, rate_type, rate_amount,
                hours_per_day, end_date, md_limit, created_at
           FROM contracts WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(id) as DbRow | undefined;
    return row ? toRow(row) : null;
  }

  /** Returns the contract that contains `asOf` (default = today), or null. */
  activeForProject(projectId: number, asOf?: string): ProjectRateRow | null {
    const today = asOf ?? todayStr();
    const row = this.db
      .prepare(
        `SELECT id, project_id, effective_from, rate_type, rate_amount,
                hours_per_day, end_date, md_limit, created_at
           FROM contracts
          WHERE project_id = ?
            AND effective_from <= ?
            AND (end_date IS NULL OR end_date >= ?)
            AND deleted_at IS NULL
          ORDER BY effective_from DESC, id DESC
          LIMIT 1`,
      )
      .get(projectId, today, today) as DbRow | undefined;
    return row ? toRow(row) : null;
  }

  create(input: ProjectRateInput): ProjectRateRow {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.autoClosePrevious(input.projectId, input.effectiveFrom);
      this.assertNoOverlap(input.projectId, input.effectiveFrom, input.endDate ?? null, null);
      const info = this.db
        .prepare(
          `INSERT INTO contracts
             (project_id, effective_from, rate_type, rate_amount,
              hours_per_day, end_date, md_limit, sync_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.projectId,
          input.effectiveFrom,
          input.rateType,
          input.rateAmount,
          input.hoursPerDay ?? 8,
          input.endDate ?? null,
          input.mdLimit ?? null,
          newSyncId(), nowIso(),
        ) as { lastInsertRowid: number | bigint };
      this.db.exec('COMMIT');
      return this.get(Number(info.lastInsertRowid))!;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  update(id: number, input: Partial<ProjectRateInput>): ProjectRateRow {
    const current = this.get(id);
    if (!current) throw new Error(`project_rate ${id} not found`);

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const nextFrom = input.effectiveFrom ?? current.effectiveFrom;
      const nextTo = input.endDate !== undefined ? input.endDate : current.endDate;
      this.assertNoOverlap(current.projectId, nextFrom, nextTo, id);

      const sets: string[] = [];
      const params: unknown[] = [];
      const push = (col: string, value: unknown) => {
        sets.push(`${col} = ?`);
        params.push(value);
      };
      if (input.effectiveFrom !== undefined) push('effective_from', input.effectiveFrom);
      if (input.endDate !== undefined) push('end_date', input.endDate);
      if (input.rateType !== undefined) push('rate_type', input.rateType);
      if (input.rateAmount !== undefined) push('rate_amount', input.rateAmount);
      if (input.hoursPerDay !== undefined) push('hours_per_day', input.hoursPerDay);
      if (input.mdLimit !== undefined) push('md_limit', input.mdLimit);
      push('updated_at', nowIso());

      if (sets.length > 0) {
        params.push(id);
        this.db
          .prepare(`UPDATE contracts SET ${sets.join(', ')} WHERE id = ?`)
          .run(...params);
      }
      this.db.exec('COMMIT');
      return this.get(id)!;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  delete(id: number): void {
    const ts = nowIso();
    this.db.prepare(`UPDATE contracts SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(ts, ts, id);
  }

  /**
   * Closes any open-ended (end_date IS NULL) contract on this project whose
   * effective_from is strictly before the new contract's start date. The
   * closed contract gets end_date = new_from - 1 day. Must run inside a
   * transaction already opened by the caller.
   */
  private autoClosePrevious(projectId: number, newFrom: string): void {
    const dayBefore = previousDay(newFrom);
    this.db
      .prepare(
        `UPDATE contracts
            SET end_date = ?, updated_at = ?
          WHERE project_id = ?
            AND end_date IS NULL
            AND effective_from < ?
            AND deleted_at IS NULL`,
      )
      .run(dayBefore, nowIso(), projectId, newFrom);
  }

  /**
   * Throws RateOverlapError if any other contract on `projectId` intersects
   * the range [from, to] (to = null is treated as +∞). Passing `excludeId`
   * skips that row, used during update.
   */
  private assertNoOverlap(
    projectId: number,
    from: string,
    to: string | null,
    excludeId: number | null,
  ): void {
    const SENTINEL_END = '9999-12-31';
    const row = this.db
      .prepare(
        `SELECT id, effective_from, end_date FROM contracts
          WHERE project_id = ?
            AND (? IS NULL OR id != ?)
            AND effective_from <= ?
            AND COALESCE(end_date, ?) >= ?
            AND deleted_at IS NULL
          LIMIT 1`,
      )
      .get(
        projectId,
        excludeId,
        excludeId,
        to ?? SENTINEL_END,
        SENTINEL_END,
        from,
      ) as { id: number; effective_from: string; end_date: string | null } | undefined;
    if (row) {
      throw new RateOverlapError(row.id, row.effective_from, row.end_date);
    }
  }
}

function todayStr(): string {
  const d = new Date();
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

/** YYYY-MM-DD → previous calendar day, YYYY-MM-DD. */
function previousDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) return date;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  return (
    dt.getFullYear() +
    '-' +
    String(dt.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(dt.getDate()).padStart(2, '0')
  );
}
