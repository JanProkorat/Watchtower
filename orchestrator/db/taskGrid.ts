import type { SqliteLike } from './migrations.js';

export interface TaskGridTask {
  taskId: number;
  taskNumber: string;
  taskTitle: string;
  status: 'open' | 'in_progress' | 'done';
  estimatedMinutes: number | null;
  /** Sum of `worklogs.minutes` (actual time) for the task in the month. */
  totalTracked: number;
  /** Sum of COALESCE(reported_minutes, minutes) (billed time) for the task. */
  totalReported: number;
  epicId: number;
  epicName: string;
  projectId: number;
  projectName: string;
  projectColor: string;
  isBillable: boolean;
  /** day-of-month → tracked minutes (raw `worklogs.minutes`). */
  perDayTracked: Record<number, number>;
  /** day-of-month → reported minutes (COALESCE(reported_minutes, minutes)). */
  perDayReported: Record<number, number>;
}

export interface TaskGridEarningsRow {
  currency: string;
  /** day-of-month (1..31) → rounded earnings amount on that day. */
  perDay: Record<number, number>;
  totalAmount: number;
}

export interface TaskGridResponse {
  year: number;
  /** 1-based month (Jan=1..Dec=12). */
  month: number;
  daysInMonth: number;
  tasks: TaskGridTask[];
  /** day-of-month → grand-total tracked minutes across all tasks shown. */
  dailyTotalsTracked: Record<number, number>;
  /** day-of-month → grand-total reported minutes across all tasks shown. */
  dailyTotalsReported: Record<number, number>;
  /** Earnings always use reported minutes — that's what gets billed. */
  earningsByCurrency: TaskGridEarningsRow[];
  /**
   * Expected working capacity for the month — Mon-Fri workdays × 8h. Phase
   * 19 will subtract Czech public holidays + days_off; the helper signature
   * is stable.
   */
  monthCapacityMinutes: number;
}

interface TaskMetaRow {
  task_id: number;
  task_number: string;
  task_title: string;
  status: 'open' | 'in_progress' | 'done';
  estimated_minutes: number | null;
  epic_id: number;
  epic_name: string;
  project_id: number;
  project_name: string;
  project_color: string;
  project_kind: 'work' | 'time_off';
}

interface WorklogPeriodRow {
  task_id: number;
  project_id: number;
  work_date: string;
  /** Raw `worklogs.minutes` — the actually tracked time. */
  tracked_minutes: number;
  /**
   * COALESCE(reported_minutes, minutes) — reported value when set, otherwise
   * the tracked fallback. Used as the displayed/billed quantity throughout
   * the module by default.
   */
  reported_minutes: number;
}

interface RateRow {
  id: number;
  project_id: number;
  effective_from: string;
  end_date: string | null;
  rate_type: 'hourly' | 'daily';
  rate_amount: number;
  currency: string;
  hours_per_day: number;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function monthBounds(year: number, month: number): { from: string; to: string; daysInMonth: number } {
  const daysInMonth = new Date(year, month, 0).getDate(); // month is 1-based; this gets day 0 of next month = last day of current
  return {
    from: `${year}-${pad2(month)}-01`,
    to: `${year}-${pad2(month)}-${pad2(daysInMonth)}`,
    daysInMonth,
  };
}

/**
 * Mon-Fri count for the month. Phase 19 will subtract Czech public holidays
 * + days_off here; until then the contract status helper and the task grid
 * use the same simplified definition so capacity numbers stay consistent
 * across the module.
 */
function countMonWedFriWorkdays(year: number, month: number): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

/**
 * Builds the per-task ⇄ per-day matrix for a single month.
 *
 * Only tasks that have at least one worklog inside the month are returned —
 * matches TimeTracker's TaskGridPage behaviour. Empty months render an
 * empty-state in the client.
 */
export class TaskGridService {
  constructor(private db: SqliteLike) {}

  get(year: number, month: number, projectId?: number): TaskGridResponse {
    const { from, to, daysInMonth } = monthBounds(year, month);
    const monthCapacityMinutes = countMonWedFriWorkdays(year, month) * 8 * 60;

    // 1. Fetch worklogs in the period scoped to the optional project.
    //    Both tracked + reported come back so the client can flip between
    //    them without re-fetching. Earnings always use reported (billing).
    const worklogParams: unknown[] = [from, to];
    let worklogSql =
      `SELECT w.task_id, p.id AS project_id, w.work_date,
              w.minutes AS tracked_minutes,
              COALESCE(w.reported_minutes, w.minutes) AS reported_minutes
         FROM worklogs w
         JOIN tasks t ON t.id = w.task_id
         JOIN epics e ON e.id = t.epic_id
         JOIN projects p ON p.id = e.project_id
        WHERE w.work_date >= ? AND w.work_date <= ?`;
    if (projectId !== undefined) {
      worklogSql += ' AND p.id = ?';
      worklogParams.push(projectId);
    }
    const worklogs = this.db.prepare(worklogSql).all(...worklogParams) as WorklogPeriodRow[];

    if (worklogs.length === 0) {
      return {
        year,
        month,
        daysInMonth,
        tasks: [],
        dailyTotalsTracked: {},
        dailyTotalsReported: {},
        earningsByCurrency: [],
        monthCapacityMinutes,
      };
    }

    // 2. Fetch the meta for every task that appeared in worklogs.
    const taskIds = Array.from(new Set(worklogs.map((w) => w.task_id)));
    const taskMetaSql = `
      SELECT
        t.id AS task_id, t.number AS task_number, t.title AS task_title,
        t.status, t.estimated_minutes,
        e.id AS epic_id, e.name AS epic_name, e.display_order AS epic_display_order,
        p.id AS project_id, p.name AS project_name, p.color AS project_color,
        p.kind AS project_kind
      FROM tasks t
      JOIN epics e ON e.id = t.epic_id
      JOIN projects p ON p.id = e.project_id
      WHERE t.id IN (${taskIds.map(() => '?').join(',')})
    `;
    const taskMeta = this.db.prepare(taskMetaSql).all(...taskIds) as Array<
      TaskMetaRow & { epic_display_order: number | null }
    >;

    // 3. Build per-task per-day maps (tracked + reported) and per-task totals.
    interface TaskBucket {
      perDayTracked: Record<number, number>;
      perDayReported: Record<number, number>;
      totalTracked: number;
      totalReported: number;
    }
    const perTask = new Map<number, TaskBucket>();
    for (const w of worklogs) {
      const day = Number(w.work_date.slice(8, 10));
      const bucket = perTask.get(w.task_id) ?? {
        perDayTracked: {},
        perDayReported: {},
        totalTracked: 0,
        totalReported: 0,
      };
      bucket.perDayTracked[day] = (bucket.perDayTracked[day] ?? 0) + w.tracked_minutes;
      bucket.perDayReported[day] = (bucket.perDayReported[day] ?? 0) + w.reported_minutes;
      bucket.totalTracked += w.tracked_minutes;
      bucket.totalReported += w.reported_minutes;
      perTask.set(w.task_id, bucket);
    }

    // 4. Build the per-day grand totals (both flavours) across visible tasks.
    const dailyTotalsTracked: Record<number, number> = {};
    const dailyTotalsReported: Record<number, number> = {};
    for (const w of worklogs) {
      const day = Number(w.work_date.slice(8, 10));
      dailyTotalsTracked[day] = (dailyTotalsTracked[day] ?? 0) + w.tracked_minutes;
      dailyTotalsReported[day] = (dailyTotalsReported[day] ?? 0) + w.reported_minutes;
    }

    // 5. Build the task list in stable order (project name, epic display_order, task id).
    const orderedTasks: TaskGridTask[] = taskMeta
      .slice()
      .sort((a, b) => {
        const pn = a.project_name.localeCompare(b.project_name);
        if (pn !== 0) return pn;
        const eo = (a.epic_display_order ?? 0) - (b.epic_display_order ?? 0);
        if (eo !== 0) return eo;
        return a.task_id - b.task_id;
      })
      .map((t) => {
        const bucket = perTask.get(t.task_id) ?? {
          perDayTracked: {},
          perDayReported: {},
          totalTracked: 0,
          totalReported: 0,
        };
        return {
          taskId: t.task_id,
          taskNumber: t.task_number,
          taskTitle: t.task_title,
          status: t.status,
          estimatedMinutes: t.estimated_minutes,
          totalTracked: bucket.totalTracked,
          totalReported: bucket.totalReported,
          epicId: t.epic_id,
          epicName: t.epic_name,
          projectId: t.project_id,
          projectName: t.project_name,
          projectColor: t.project_color,
          isBillable: t.project_kind === 'work',
          perDayTracked: bucket.perDayTracked,
          perDayReported: bucket.perDayReported,
        };
      });

    // 6. Earnings by currency — only billable projects contribute, and the
    //    rate is picked per-worklog from the contract that contained the
    //    work_date. Worklogs in months that straddle a contract boundary
    //    therefore split correctly across rates.
    const earningsByCurrency = this.computeEarnings(worklogs, taskMeta);

    return {
      year,
      month,
      daysInMonth,
      tasks: orderedTasks,
      dailyTotalsTracked,
      dailyTotalsReported,
      earningsByCurrency,
      monthCapacityMinutes,
    };
  }

  private computeEarnings(
    worklogs: WorklogPeriodRow[],
    taskMeta: TaskMetaRow[],
  ): TaskGridEarningsRow[] {
    // Project → kind lookup so non-work projects can be skipped.
    const billableByProject = new Map<number, boolean>();
    for (const t of taskMeta) {
      billableByProject.set(t.project_id, t.project_kind === 'work');
    }

    // Pre-load all rates for any project that has billable worklogs.
    const projectIds = Array.from(
      new Set(
        worklogs
          .filter((w) => billableByProject.get(w.project_id) === true)
          .map((w) => w.project_id),
      ),
    );
    if (projectIds.length === 0) return [];

    const ratesSql = `
      SELECT id, project_id, effective_from, end_date, rate_type, rate_amount, currency, hours_per_day
        FROM project_rates
       WHERE project_id IN (${projectIds.map(() => '?').join(',')})
       ORDER BY project_id, effective_from DESC
    `;
    const allRates = this.db.prepare(ratesSql).all(...projectIds) as RateRow[];
    const ratesByProject = new Map<number, RateRow[]>();
    for (const r of allRates) {
      const list = ratesByProject.get(r.project_id) ?? [];
      list.push(r);
      ratesByProject.set(r.project_id, list);
    }

    function findRateForDate(projectId: number, date: string): RateRow | null {
      const rates = ratesByProject.get(projectId);
      if (!rates) return null;
      for (const r of rates) {
        if (r.effective_from <= date && (r.end_date === null || r.end_date >= date)) {
          return r;
        }
      }
      return null;
    }

    // Currency → day → rounded amount, plus total. Earnings always use
    // reported_minutes (the billed value) regardless of the client's
    // display toggle.
    const byCurrency = new Map<string, { perDay: Record<number, number>; total: number }>();
    for (const w of worklogs) {
      if (!billableByProject.get(w.project_id)) continue;
      const rate = findRateForDate(w.project_id, w.work_date);
      if (!rate) continue;

      const hours = w.reported_minutes / 60;
      const amount =
        rate.rate_type === 'hourly'
          ? hours * rate.rate_amount
          : (hours / rate.hours_per_day) * rate.rate_amount;
      const day = Number(w.work_date.slice(8, 10));

      const bucket = byCurrency.get(rate.currency) ?? { perDay: {}, total: 0 };
      // Sum as floats during accumulation, round at the end so per-day reads
      // stay consistent with the displayed total.
      bucket.perDay[day] = (bucket.perDay[day] ?? 0) + amount;
      bucket.total += amount;
      byCurrency.set(rate.currency, bucket);
    }

    const out: TaskGridEarningsRow[] = [];
    for (const [currency, bucket] of byCurrency) {
      const perDayRounded: Record<number, number> = {};
      for (const [day, val] of Object.entries(bucket.perDay)) {
        perDayRounded[Number(day)] = Math.round(val);
      }
      out.push({
        currency,
        perDay: perDayRounded,
        totalAmount: Math.round(bucket.total),
      });
    }
    // Stable order: alphabetical by currency code (CZK before EUR before USD).
    out.sort((a, b) => a.currency.localeCompare(b.currency));
    return out;
  }
}
