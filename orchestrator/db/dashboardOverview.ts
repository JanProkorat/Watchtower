import type { SqliteLike } from './migrations.js';
import { ReportsService } from './reports.js';
import { ContractStatusService } from './contractStatus.js';
import type {
  DashboardActiveContractPayload,
  DashboardOverviewRequestPayload,
  DashboardOverviewResponsePayload,
  DashboardSprintDayPayload,
  DashboardHeatmapStatsPayload,
  DashboardTopProjectPayload,
  DashboardSprintWorklogPayload,
} from '@watchtower/shared/ipcContract.js';

interface MinutesRow {
  /** SQL COALESCE(..., 0) guarantees non-null. */
  minutes: number;
}

interface MinutesByDateRow {
  work_date: string;
  minutes: number;
}

interface SprintWorklogJoinedRow {
  id: number;
  task_number: string | null;
  task_title: string;
  project_name: string;
  project_color: string | null;
  work_date: string;
  minutes: number;
  description: string | null;
}

interface TopProjectRow {
  project_id: number;
  project_name: string;
  project_color: string | null;
  minutes: number;
}

function projectClause(projectId: number | null): { sql: string; params: number[] } {
  if (projectId == null) return { sql: '', params: [] };
  return { sql: ' AND p.id = ?', params: [projectId] };
}

export class DashboardOverviewService {
  constructor(private readonly db: SqliteLike) {}

  run(req: DashboardOverviewRequestPayload): DashboardOverviewResponsePayload {
    const { projectId, sprintAnchor, todayDate } = req;
    const reports = new ReportsService(this.db);

    const todayEarned = reports.earnings(todayDate, todayDate, projectId ?? undefined).totalEarned;
    const monthFrom = todayDate.slice(0, 7) + '-01';
    const monthTo = lastDayOfMonth(todayDate);
    const monthEarned = reports.earnings(monthFrom, monthTo, projectId ?? undefined).totalEarned;

    const sprint = this.sprintFor(sprintAnchor, projectId);
    const sprintEarned = reports.earnings(sprint.fromDate, sprint.toDate, projectId ?? undefined).totalEarned;

    const today = { minutes: this.sumForDate(todayDate, projectId), earned: todayEarned };
    const month = { minutes: this.sumForMonth(todayDate, projectId), earned: monthEarned };
    const heatmap30d = this.heatmap30d(todayDate, projectId);
    const topProjects = this.topProjects(todayDate, projectId);
    const activeContracts = this.activeContracts(todayDate);
    return {
      today,
      month,
      sprint: { ...sprint, totalEarned: sprintEarned },
      heatmap30d,
      topProjects,
      activeContracts,
    };
  }

  /**
   * Every non-archived `work` project that has an active contract row with
   * either an end_date or an md_limit. Independent of the dashboard's
   * project filter — the active-contracts card surfaces budget health
   * across all projects regardless of which one the user is filtering by.
   *
   * Sort order matches TT's dashboard: contracts whose projected total
   * overshoots their md_limit by the largest amount come first, then ones
   * within budget, then open-ended / un-projected ones, then alphabetical.
   */
  private activeContracts(todayDate: string): DashboardActiveContractPayload[] {
    interface Row {
      project_id: number;
      project_name: string;
      project_color: string;
    }
    const rows = this.db
      .prepare(
        `SELECT DISTINCT p.id    AS project_id,
                         p.name  AS project_name,
                         p.color AS project_color
           FROM projects p
           JOIN contracts pr ON pr.project_id = p.id
          WHERE p.archived = 0
            AND p.kind = 'work'
            AND pr.effective_from <= ?
            AND (pr.end_date IS NULL OR pr.end_date >= ?)
            AND (pr.end_date IS NOT NULL OR pr.md_limit IS NOT NULL)
            AND p.deleted_at IS NULL AND pr.deleted_at IS NULL
          ORDER BY p.name ASC`,
      )
      .all(todayDate, todayDate) as Row[];

    const svc = new ContractStatusService(this.db);
    const out: DashboardActiveContractPayload[] = [];
    for (const r of rows) {
      const contract = svc.forProject(r.project_id, todayDate);
      if (!contract) continue;
      out.push({
        projectId: r.project_id,
        projectName: r.project_name,
        projectColor: r.project_color,
        contract,
      });
    }

    out.sort((a, b) => {
      const sa = overshootScore(a.contract.projectedTotalMds, a.contract.mdLimit);
      const sb = overshootScore(b.contract.projectedTotalMds, b.contract.mdLimit);
      if (sa !== sb) return sb - sa;
      return a.projectName.localeCompare(b.projectName);
    });
    return out;
  }

  private sumForDate(date: string, projectId: number | null): number {
    const pc = projectClause(projectId);
    const sql = `
      SELECT COALESCE(SUM(w.minutes), 0) AS minutes
      FROM worklogs w
      JOIN tasks   t ON t.id = w.task_id
      JOIN epics   e ON e.id = t.epic_id
      JOIN projects p ON p.id = e.project_id
      WHERE w.work_date = ?
        AND w.deleted_at IS NULL AND t.deleted_at IS NULL AND e.deleted_at IS NULL AND p.deleted_at IS NULL${pc.sql}
    `;
    const row = this.db.prepare(sql).get(date, ...pc.params) as MinutesRow | undefined;
    return row?.minutes ?? 0;
  }

  private sumForMonth(todayDate: string, projectId: number | null): number {
    const ym = todayDate.slice(0, 7);
    const pc = projectClause(projectId);
    const sql = `
      SELECT COALESCE(SUM(w.minutes), 0) AS minutes
      FROM worklogs w
      JOIN tasks   t ON t.id = w.task_id
      JOIN epics   e ON e.id = t.epic_id
      JOIN projects p ON p.id = e.project_id
      WHERE strftime('%Y-%m', w.work_date) = ?
        AND w.deleted_at IS NULL AND t.deleted_at IS NULL AND e.deleted_at IS NULL AND p.deleted_at IS NULL${pc.sql}
    `;
    const row = this.db.prepare(sql).get(ym, ...pc.params) as MinutesRow | undefined;
    return row?.minutes ?? 0;
  }

  private sprintFor(sprintAnchor: string, projectId: number | null) {
    const startDate = readStringSetting(this.db, 'dashboard.sprint.startDate', '2026-01-05');
    const lengthDays = readIntSetting(this.db, 'dashboard.sprint.lengthDays', 14);
    const { fromDate, toDate } = sprintWindow(sprintAnchor, startDate, lengthDays);
    const pc = projectClause(projectId);
    const sql = `
      SELECT w.id,
             t.number AS task_number,
             t.title  AS task_title,
             p.name   AS project_name,
             p.color  AS project_color,
             w.work_date,
             w.minutes,
             w.description
      FROM worklogs w
      JOIN tasks   t ON t.id = w.task_id
      JOIN epics   e ON e.id = t.epic_id
      JOIN projects p ON p.id = e.project_id
      WHERE w.work_date BETWEEN ? AND ?
        AND w.deleted_at IS NULL AND t.deleted_at IS NULL AND e.deleted_at IS NULL AND p.deleted_at IS NULL${pc.sql}
      ORDER BY w.work_date ASC, w.minutes DESC, w.id ASC
    `;
    const rows = this.db.prepare(sql).all(fromDate, toDate, ...pc.params) as SprintWorklogJoinedRow[];

    const days: DashboardSprintDayPayload[] = [];
    for (let i = 0; i < lengthDays; i++) {
      const date = addDays(fromDate, i);
      const dayWls: DashboardSprintWorklogPayload[] = rows
        .filter((r) => r.work_date === date)
        .map((r) => ({
          id: r.id,
          taskNumber: r.task_number,
          taskTitle: r.task_title,
          projectName: r.project_name,
          projectColor: r.project_color,
          minutes: r.minutes,
          note: r.description,
        }));
      const minutes = dayWls.reduce((acc, w) => acc + w.minutes, 0);
      days.push({ date, minutes, worklogs: dayWls });
    }
    const totalMinutes = days.reduce((acc, d) => acc + d.minutes, 0);
    return { fromDate, toDate, lengthDays, totalMinutes, days };
  }

  private heatmap30d(todayDate: string, projectId: number | null) {
    const fromDate = addDays(todayDate, -29);
    const toDate = todayDate;
    const pc = projectClause(projectId);
    const sql = `
      SELECT w.work_date, SUM(w.minutes) AS minutes
      FROM worklogs w
      JOIN tasks   t ON t.id = w.task_id
      JOIN epics   e ON e.id = t.epic_id
      JOIN projects p ON p.id = e.project_id
      WHERE w.work_date BETWEEN ? AND ?
        AND w.deleted_at IS NULL AND t.deleted_at IS NULL AND e.deleted_at IS NULL AND p.deleted_at IS NULL${pc.sql}
      GROUP BY w.work_date
      ORDER BY w.work_date ASC
    `;
    const grouped = this.db.prepare(sql).all(fromDate, toDate, ...pc.params) as MinutesByDateRow[];
    const map = new Map(grouped.map((r) => [r.work_date, r.minutes]));

    const days: { date: string; minutes: number }[] = [];
    for (let i = 0; i < 30; i++) {
      const date = addDays(fromDate, i);
      days.push({ date, minutes: map.get(date) ?? 0 });
    }
    const stats = computeStats(days, todayDate);
    return { fromDate, toDate, days, stats };
  }

  private topProjects(todayDate: string, projectId: number | null): DashboardTopProjectPayload[] {
    const ym = todayDate.slice(0, 7);
    const pc = projectClause(projectId);
    const sql = `
      SELECT p.id AS project_id, p.name AS project_name, p.color AS project_color,
             SUM(w.minutes) AS minutes
      FROM worklogs w
      JOIN tasks   t ON t.id = w.task_id
      JOIN epics   e ON e.id = t.epic_id
      JOIN projects p ON p.id = e.project_id
      WHERE strftime('%Y-%m', w.work_date) = ?
        AND w.deleted_at IS NULL AND t.deleted_at IS NULL AND e.deleted_at IS NULL AND p.deleted_at IS NULL${pc.sql}
      GROUP BY p.id, p.name, p.color
      HAVING SUM(w.minutes) > 0
      ORDER BY minutes DESC, p.name ASC
    `;
    const rows = this.db.prepare(sql).all(ym, ...pc.params) as TopProjectRow[];
    return rows.map((r) => ({
      projectId: r.project_id,
      projectName: r.project_name,
      projectColor: r.project_color,
      minutes: r.minutes,
    }));
  }
}

function overshootScore(
  projected: number | null,
  limit: number | null,
): number {
  if (projected == null || limit == null) return -Infinity;
  return projected - limit;
}

function sprintWindow(anchor: string, startDate: string, lengthDays: number) {
  const days = daysBetween(startDate, anchor);
  const sprintIndex = Math.floor(days / lengthDays);
  const fromDate = addDays(startDate, sprintIndex * lengthDays);
  const toDate = addDays(fromDate, lengthDays - 1);
  return { fromDate, toDate };
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00Z').getTime();
  const db_ = new Date(b + 'T00:00:00Z').getTime();
  return Math.round((db_ - da) / 86_400_000);
}

function readStringSetting(db: SqliteLike, key: string, fallback: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

function readIntSetting(db: SqliteLike, key: string, fallback: number): number {
  const v = readStringSetting(db, key, String(fallback));
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 1 && n <= 56 ? n : fallback;
}

function lastDayOfMonth(date: string): string {
  // date = YYYY-MM-DD; want the YYYY-MM-{last_day_of_that_month}.
  const parts = date.split('-').map(Number);
  const y = parts[0] as number;
  const m = parts[1] as number;
  // Day 0 of next month = last day of current month.
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function computeStats(
  days: { date: string; minutes: number }[],
  todayDate: string,
): DashboardHeatmapStatsPayload {
  const map = new Map(days.map((d) => [d.date, d.minutes]));
  const activeDays = days.filter((d) => d.minutes > 0).length;
  const totalMinutes = days.reduce((acc, d) => acc + d.minutes, 0);
  const weeklyAvgMinutes = Math.round((totalMinutes / 30) * 7);

  let cursor = todayDate;
  let currentStreak = 0;
  while (map.has(cursor) && (map.get(cursor) ?? 0) > 0) {
    currentStreak++;
    cursor = addDays(cursor, -1);
  }

  let longestStreak = 0;
  let run = 0;
  for (const d of days) {
    if (d.minutes > 0) {
      run++;
      if (run > longestStreak) longestStreak = run;
    } else {
      run = 0;
    }
  }

  let busiestDay: { date: string; minutes: number } | null = null;
  for (const d of days) {
    if (d.minutes > 0 && (busiestDay === null || d.minutes > busiestDay.minutes)) {
      busiestDay = { date: d.date, minutes: d.minutes };
    }
  }

  return { currentStreak, longestStreak, activeDays, weeklyAvgMinutes, busiestDay };
}
