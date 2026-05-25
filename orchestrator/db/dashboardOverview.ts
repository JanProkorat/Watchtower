import type { SqliteLike } from './migrations.js';
import type {
  DashboardOverviewRequestPayload,
  DashboardOverviewResponsePayload,
  DashboardSprintDayPayload,
  DashboardHeatmapStatsPayload,
  DashboardTopProjectPayload,
} from '../../shared/ipcContract.js';

interface MinutesRow {
  /** SQL COALESCE(..., 0) guarantees non-null. */
  minutes: number;
}

interface MinutesByDateRow {
  work_date: string;
  minutes: number;
}

interface WorklogJoinedRow {
  id: number;
  task_number: string | null;
  project_name: string;
  project_color: string | null;
  minutes: number;
  description: string | null;
  work_date: string;
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
    const today = { minutes: this.sumForDate(todayDate, projectId) };
    const month = { minutes: this.sumForMonth(todayDate, projectId) };
    const sprint = this.sprintFor(sprintAnchor, projectId);
    const heatmap30d = this.heatmap30d(todayDate, projectId);
    const topProjects = this.topProjects(todayDate, projectId);
    return { today, month, sprint, heatmap30d, topProjects };
  }

  private sumForDate(date: string, projectId: number | null): number {
    const pc = projectClause(projectId);
    const sql = `
      SELECT COALESCE(SUM(w.minutes), 0) AS minutes
      FROM worklogs w
      JOIN tasks   t ON t.id = w.task_id
      JOIN epics   e ON e.id = t.epic_id
      JOIN projects p ON p.id = e.project_id
      WHERE w.work_date = ?${pc.sql}
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
      WHERE strftime('%Y-%m', w.work_date) = ?${pc.sql}
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
      SELECT w.id, t.number AS task_number, p.name AS project_name, p.color AS project_color,
             w.minutes, w.description, w.work_date
      FROM worklogs w
      JOIN tasks   t ON t.id = w.task_id
      JOIN epics   e ON e.id = t.epic_id
      JOIN projects p ON p.id = e.project_id
      WHERE w.work_date BETWEEN ? AND ?${pc.sql}
      ORDER BY w.work_date ASC, w.id ASC
    `;
    const rows = this.db.prepare(sql).all(fromDate, toDate, ...pc.params) as WorklogJoinedRow[];

    const days: DashboardSprintDayPayload[] = [];
    for (let i = 0; i < lengthDays; i++) {
      const date = addDays(fromDate, i);
      const dayWls = rows
        .filter((r) => r.work_date === date)
        .map((r) => ({
          id: r.id,
          taskNumber: r.task_number,
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
      WHERE w.work_date BETWEEN ? AND ?${pc.sql}
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
      WHERE strftime('%Y-%m', w.work_date) = ?${pc.sql}
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
