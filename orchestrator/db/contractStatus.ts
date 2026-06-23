import type { SqliteLike } from './migrations.js';
import { effectiveMinutes } from './reportsSql.js';
import { ProjectRatesRepo, type ProjectRateRow } from './repositories/projectRates.js';
import { countWorkdays } from './workdays.js';
import { DaysOffRepo } from './repositories/daysOff.js';

export interface ContractStatus {
  rateId: number;
  projectId: number;
  effectiveFrom: string;
  endDate: string | null;
  hoursPerDay: number;
  mdLimit: number | null;
  /**
   * Total billable minutes logged inside the contract period (so far), using
   * the EFFECTIVE_MINUTES basis (reported_minutes when set, else tracked).
   */
  minutesLogged: number;
  /** minutesLogged ÷ 60 ÷ hoursPerDay, rounded to 2dp. */
  mdsUsed: number;
  /** mdLimit - mdsUsed when mdLimit set, else null. */
  mdsRemaining: number | null;
  /** Approximate elapsed workdays inside the contract period (today included). */
  elapsedWorkdays: number;
  /** Approximate total workdays in the contract period (or null when open-ended). */
  totalWorkdays: number | null;
  /** Workdays remaining until end_date (or null when open-ended). */
  workdaysRemaining: number | null;
  /**
   * mdsUsed extrapolated to the end of the contract period. Computed only
   * when the contract has an end_date and at least one elapsed workday.
   */
  projectedTotalMds: number | null;
  /** Whether `asOf` (default = today) lies inside this contract's range. */
  isActive: boolean;
  /** True if end_date < asOf. */
  isCompleted: boolean;
}

/**
 * Computes the live status of a project's *active* contract — or any
 * specific rate when an `asOf` date is supplied — from worklogs + the shared
 * workday counter (Mon-Fri minus Czech public holidays). Phase 19 will
 * extend the helper to also subtract days_off; this module is unaffected by
 * that change because the contract math just consumes the count.
 */
export class ContractStatusService {
  private rates: ProjectRatesRepo;

  constructor(private db: SqliteLike) {
    this.rates = new ProjectRatesRepo(db);
  }

  /** Status for the active contract on this project, or null if none. */
  forProject(projectId: number, asOf?: string): ContractStatus | null {
    const rate = this.rates.activeForProject(projectId, asOf);
    if (!rate) return null;
    return this.forRate(rate, asOf);
  }

  /** Status for a specific contract row — used when listing all contracts. */
  forRate(rate: ProjectRateRow, asOf?: string): ContractStatus {
    const today = asOf ?? todayStr();
    const periodEnd = rate.endDate ?? today; // for "elapsed" we cap at today
    const effectiveTo = rate.endDate ?? null;

    // Only billable worklogs (project.kind = 'work') count toward MD usage.
    // Uses EFFECTIVE_MINUTES (reported wins, tracked is the fallback) so the
    // contract MD figure shares the billable basis of the trend/earnings
    // charts — what's actually invoiced against the md_limit. Joined through
    // tasks → epics → projects so the project filter applies to every worklog.
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(${effectiveMinutes('w')}), 0) AS minutes
           FROM worklogs w
           JOIN tasks t  ON t.id = w.task_id
           JOIN epics e  ON e.id = t.epic_id
           JOIN projects p ON p.id = e.project_id
          WHERE e.project_id = ?
            AND p.kind = 'work'
            AND w.work_date >= ?
            AND w.work_date <= ?
            AND w.deleted_at IS NULL AND t.deleted_at IS NULL AND e.deleted_at IS NULL AND p.deleted_at IS NULL`,
      )
      .get(rate.projectId, rate.effectiveFrom, periodEnd) as { minutes: number };

    const minutesLogged = row.minutes ?? 0;
    const mdsUsed = round2(minutesLogged / 60 / rate.hoursPerDay);
    const mdsRemaining = rate.mdLimit != null ? round2(rate.mdLimit - mdsUsed) : null;

    // Pre-load every days_off row inside the contract's full date span so
    // each countWorkdays call below can dedupe against the same set without
    // re-querying the table.
    const daysOffSpanFrom = rate.effectiveFrom;
    const daysOffSpanTo = effectiveTo ?? today;
    const daysOffSet = new Set(
      new DaysOffRepo(this.db)
        .listInRange(daysOffSpanFrom, daysOffSpanTo)
        .map((d) => d.date),
    );

    const elapsedWorkdays = countWorkdays(
      rate.effectiveFrom,
      minDate(today, periodEnd),
      daysOffSet,
    );
    const totalWorkdays = effectiveTo
      ? countWorkdays(rate.effectiveFrom, effectiveTo, daysOffSet)
      : null;
    const workdaysRemaining =
      effectiveTo && today <= effectiveTo
        ? countWorkdays(addDay(today), effectiveTo, daysOffSet)
        : effectiveTo
          ? 0
          : null;

    const projectedTotalMds =
      totalWorkdays != null && elapsedWorkdays > 0
        ? round2((mdsUsed / elapsedWorkdays) * totalWorkdays)
        : null;

    const isActive =
      today >= rate.effectiveFrom && (effectiveTo == null || today <= effectiveTo);
    const isCompleted = effectiveTo != null && today > effectiveTo;

    return {
      rateId: rate.id,
      projectId: rate.projectId,
      effectiveFrom: rate.effectiveFrom,
      endDate: rate.endDate,
      hoursPerDay: rate.hoursPerDay,
      mdLimit: rate.mdLimit,
      minutesLogged,
      mdsUsed,
      mdsRemaining,
      elapsedWorkdays,
      totalWorkdays,
      workdaysRemaining,
      projectedTotalMds,
      isActive,
      isCompleted,
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function todayStr(): string {
  const d = new Date();
  return ymd(d);
}

function ymd(d: Date): string {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

function addDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) return date;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + 1);
  return ymd(dt);
}

function minDate(a: string, b: string): string {
  return a <= b ? a : b;
}

