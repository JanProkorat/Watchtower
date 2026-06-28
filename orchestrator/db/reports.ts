import type { SqliteLike } from './migrations.js';
import {
  EFFECTIVE_MINUTES,
  PROJECT_RATE_PERIODS_CTE,
  RATE_PERIOD_JOIN,
  SUM_EARNED,
  SUM_MDS,
  mdPerRow,
  effectiveMinutes,
} from './reportsSql.js';
import { ContractStatusService, type ContractStatus } from './contractStatus.js';

export type Granularity = 'day' | 'week' | 'month';

export interface TrendRow {
  bucket: string;
  minutes: number;
  /** Man-days for the bucket, using each worklog's contract hours_per_day. */
  mds: number;
  /** Total CZK earned in this bucket (0 when no billable contract applies). */
  earned: number;
}

export interface ByProjectRow {
  projectId: number;
  projectName: string;
  projectColor: string;
  isBillable: number;
  minutes: number;
  /** Man-days for the project, using its contract hours_per_day. */
  mds: number;
  earnedAmount: number | null;
}

export interface EarningsByProjectRow {
  project_id: number;
  project_name: string;
  project_color: string;
  minutes: number;
  mds: number;
  earned_amount: number | null;
}

export interface EarningsResponse {
  billableMinutes: number;
  unbillableMinutes: number;
  timeOffMinutes: number;
  /** Billable minutes expressed as man-days (per-project hours_per_day). */
  billableMds: number;
  /** Unbillable minutes expressed as man-days (per-project hours_per_day). */
  unbillableMds: number;
  /** Total CZK earned across all billable projects in the range. */
  totalEarned: number;
  /** Average CZK/h across billable projects (0 when no billable minutes). */
  avgEffectiveHourlyRate: number;
  byProject: EarningsByProjectRow[];
}

export interface HeatmapRow {
  date: string;
  minutes: number;
  /** Man-days for the day, using each worklog's contract hours_per_day. */
  mds: number;
}

export interface ContractsReportRow {
  projectId: number;
  projectName: string;
  projectColor: string;
  archived: number;
  contract: ContractStatus;
}

export interface RateChangeRow {
  projectId: number;
  projectName: string;
  projectColor: string;
  effectiveFrom: string;
  rateType: 'hourly' | 'daily';
  rateAmount: number;
}

const BUCKET_EXPR: Record<Granularity, string> = {
  day: "strftime('%Y-%m-%d', w.work_date)",
  week: "strftime('%Y-W%W', w.work_date)",
  month: "strftime('%Y-%m', w.work_date)",
};

/**
 * Ported verbatim from TimeTracker's `server/routes/reports.ts`. Same six
 * read-only queries, same SQL fragments, same wire shape. Lives in the
 * orchestrator so the renderer can hit it via IPC instead of HTTP.
 */
export class ReportsService {
  constructor(private db: SqliteLike) {}

  trend(from: string, to: string, granularity: Granularity, projectId?: number): TrendRow[] {
    const bucketExpr = BUCKET_EXPR[granularity];
    const totalsParams: unknown[] = [from, to];
    // Joined through to projects + rate periods so MD can use each worklog's
    // contract hours_per_day (falling back to 8h). The joins never drop rows —
    // every worklog has a task → epic → project, and the rate join is a LEFT.
    let totalsSql = `WITH ${PROJECT_RATE_PERIODS_CTE}
                     SELECT ${bucketExpr} AS bucket,
                            SUM(${EFFECTIVE_MINUTES}) AS minutes,
                            ${SUM_MDS} AS mds
                       FROM worklogs w
                       JOIN tasks t    ON t.id = w.task_id
                       JOIN epics e    ON e.id = t.epic_id
                       JOIN projects p ON p.id = e.project_id
                       ${RATE_PERIOD_JOIN}
                      WHERE w.work_date BETWEEN ? AND ?
                        AND w.deleted_at IS NULL AND t.deleted_at IS NULL AND e.deleted_at IS NULL AND p.deleted_at IS NULL`;
    if (projectId !== undefined) {
      totalsSql += `
                        AND e.project_id = ?`;
      totalsParams.push(projectId);
    }
    totalsSql += `
                      GROUP BY bucket
                      ORDER BY bucket ASC`;

    const totals = this.db.prepare(totalsSql).all(...totalsParams) as Array<{
      bucket: string;
      minutes: number;
      mds: number;
    }>;

    const earningsParams: unknown[] = [from, to];
    let earningsSql = `WITH ${PROJECT_RATE_PERIODS_CTE}
                       SELECT ${bucketExpr} AS bucket,
                              ${SUM_EARNED} AS earned
                         FROM worklogs w
                         JOIN tasks t    ON t.id = w.task_id
                         JOIN epics e    ON e.id = t.epic_id
                         JOIN projects p ON p.id = e.project_id
                         ${RATE_PERIOD_JOIN}
                        WHERE w.work_date BETWEEN ? AND ?
                          AND w.deleted_at IS NULL AND t.deleted_at IS NULL AND e.deleted_at IS NULL AND p.deleted_at IS NULL
                          AND p.is_billable = 1
                          AND rp.rate_amount IS NOT NULL`;
    if (projectId !== undefined) {
      earningsSql += ' AND p.id = ?';
      earningsParams.push(projectId);
    }
    earningsSql += `
                        GROUP BY bucket
                        ORDER BY bucket ASC`;

    const earnings = this.db.prepare(earningsSql).all(...earningsParams) as Array<{
      bucket: string;
      earned: number;
    }>;

    const earnedByBucket = new Map<string, number>();
    for (const row of earnings) {
      earnedByBucket.set(row.bucket, row.earned);
    }

    return totals.map((r) => ({
      bucket: r.bucket,
      minutes: r.minutes,
      mds: r.mds ?? 0,
      earned: earnedByBucket.get(r.bucket) ?? 0,
    }));
  }

  byProject(from: string, to: string, projectId?: number): ByProjectRow[] {
    const params: unknown[] = [from, to];
    let whereProject = '';
    if (projectId !== undefined) {
      whereProject = ' AND p.id = ?';
      params.push(projectId);
    }
    const rows = this.db
      .prepare(
        `WITH ${PROJECT_RATE_PERIODS_CTE}
         SELECT p.id            AS project_id,
                p.name          AS project_name,
                p.color         AS project_color,
                p.is_billable   AS is_billable,
                COALESCE(SUM(${EFFECTIVE_MINUTES}), 0) AS minutes,
                COALESCE(${SUM_MDS}, 0) AS mds,
                CASE
                  WHEN p.is_billable = 1 THEN ${SUM_EARNED}
                  ELSE NULL
                END             AS earned_amount
           FROM projects p
           LEFT JOIN epics e    ON e.project_id = p.id AND e.deleted_at IS NULL
           LEFT JOIN tasks t    ON t.epic_id    = e.id AND t.deleted_at IS NULL
           LEFT JOIN worklogs w ON w.task_id    = t.id
                                AND w.work_date BETWEEN ? AND ?
                                AND w.deleted_at IS NULL
           ${RATE_PERIOD_JOIN}
          WHERE p.deleted_at IS NULL${whereProject}
          GROUP BY p.id
          HAVING minutes > 0
          ORDER BY minutes DESC`,
      )
      .all(...params) as Array<{
        project_id: number;
        project_name: string;
        project_color: string;
        is_billable: number;
        minutes: number;
        mds: number;
        earned_amount: number | null;
      }>;

    return rows.map((r) => ({
      projectId: r.project_id,
      projectName: r.project_name,
      projectColor: r.project_color,
      isBillable: r.is_billable,
      minutes: r.minutes,
      mds: r.mds,
      earnedAmount: r.earned_amount,
    }));
  }

  earnings(from: string, to: string, projectId?: number): EarningsResponse {
    const projectFilter = projectId !== undefined ? ' AND p.id = ?' : '';
    const totalsParams: unknown[] = [from, to];
    if (projectId !== undefined) totalsParams.push(projectId);

    const totals = this.db
      .prepare(
        `WITH ${PROJECT_RATE_PERIODS_CTE}
         SELECT
            SUM(CASE WHEN p.kind = 'work' AND p.is_billable = 1 THEN ${EFFECTIVE_MINUTES} ELSE 0 END) AS billable_minutes,
            SUM(CASE WHEN p.kind = 'work' AND p.is_billable = 0 THEN ${EFFECTIVE_MINUTES} ELSE 0 END) AS unbillable_minutes,
            SUM(CASE WHEN p.kind = 'time_off' THEN ${EFFECTIVE_MINUTES} ELSE 0 END) AS time_off_minutes,
            SUM(CASE WHEN p.kind = 'work' AND p.is_billable = 1 THEN ${mdPerRow('rp')} ELSE 0 END) AS billable_mds,
            SUM(CASE WHEN p.kind = 'work' AND p.is_billable = 0 THEN ${mdPerRow('rp')} ELSE 0 END) AS unbillable_mds
           FROM worklogs w
           JOIN tasks t    ON t.id = w.task_id
           JOIN epics e    ON e.id = t.epic_id
           JOIN projects p ON p.id = e.project_id
           ${RATE_PERIOD_JOIN}
          WHERE w.work_date BETWEEN ? AND ?${projectFilter}
            AND w.deleted_at IS NULL AND t.deleted_at IS NULL AND e.deleted_at IS NULL AND p.deleted_at IS NULL`,
      )
      .get(...totalsParams) as {
        billable_minutes: number | null;
        unbillable_minutes: number | null;
        time_off_minutes: number | null;
        billable_mds: number | null;
        unbillable_mds: number | null;
      };

    const earnedParams: unknown[] = [from, to];
    if (projectId !== undefined) earnedParams.push(projectId);
    const earnedRow = this.db
      .prepare(
        `WITH ${PROJECT_RATE_PERIODS_CTE}
         SELECT ${SUM_EARNED} AS earned,
                SUM(${EFFECTIVE_MINUTES}) AS billable_minutes
           FROM worklogs w
           JOIN tasks t    ON t.id = w.task_id
           JOIN epics e    ON e.id = t.epic_id
           JOIN projects p ON p.id = e.project_id
           ${RATE_PERIOD_JOIN}
          WHERE w.work_date BETWEEN ? AND ?
            AND w.deleted_at IS NULL AND t.deleted_at IS NULL AND e.deleted_at IS NULL AND p.deleted_at IS NULL
            AND p.is_billable = 1
            AND rp.rate_amount IS NOT NULL${projectFilter}`,
      )
      .get(...earnedParams) as { earned: number | null; billable_minutes: number | null };

    const byProjParams: unknown[] = [from, to];
    if (projectId !== undefined) byProjParams.push(projectId);
    const byProject = this.db
      .prepare(
        `WITH ${PROJECT_RATE_PERIODS_CTE}
         SELECT p.id           AS project_id,
                p.name         AS project_name,
                p.color        AS project_color,
                SUM(${EFFECTIVE_MINUTES}) AS minutes,
                ${SUM_MDS} AS mds,
                ${SUM_EARNED} AS earned_amount
           FROM worklogs w
           JOIN tasks t    ON t.id = w.task_id
           JOIN epics e    ON e.id = t.epic_id
           JOIN projects p ON p.id = e.project_id
           ${RATE_PERIOD_JOIN}
          WHERE w.work_date BETWEEN ? AND ?
            AND w.deleted_at IS NULL AND t.deleted_at IS NULL AND e.deleted_at IS NULL AND p.deleted_at IS NULL
            AND p.is_billable = 1
            AND rp.rate_amount IS NOT NULL${projectFilter}
          GROUP BY p.id
          ORDER BY earned_amount DESC`,
      )
      .all(...byProjParams) as EarningsByProjectRow[];

    const totalEarned = earnedRow.earned ?? 0;
    const billableMins = earnedRow.billable_minutes ?? 0;
    const avgEffectiveHourlyRate = billableMins > 0 ? totalEarned / (billableMins / 60) : 0;

    return {
      billableMinutes: totals.billable_minutes ?? 0,
      unbillableMinutes: totals.unbillable_minutes ?? 0,
      timeOffMinutes: totals.time_off_minutes ?? 0,
      billableMds: totals.billable_mds ?? 0,
      unbillableMds: totals.unbillable_mds ?? 0,
      totalEarned,
      avgEffectiveHourlyRate,
      byProject,
    };
  }

  heatmap(from: string, to: string, projectId?: number): HeatmapRow[] {
    const params: unknown[] = [from, to];
    // Always join projects + rate periods so per-day MD uses each worklog's
    // contract hours_per_day (8h fallback). The rate join is a LEFT, so days
    // without a matching rate period still appear.
    let sql = `WITH ${PROJECT_RATE_PERIODS_CTE}
               SELECT w.work_date AS date,
                      SUM(${EFFECTIVE_MINUTES}) AS minutes,
                      ${SUM_MDS} AS mds
                 FROM worklogs w
                 JOIN tasks t    ON t.id = w.task_id
                 JOIN epics e    ON e.id = t.epic_id
                 JOIN projects p ON p.id = e.project_id
                 ${RATE_PERIOD_JOIN}
                WHERE w.work_date BETWEEN ? AND ?
                  AND w.deleted_at IS NULL AND t.deleted_at IS NULL AND e.deleted_at IS NULL AND p.deleted_at IS NULL`;
    if (projectId !== undefined) {
      sql += `
                  AND e.project_id = ?`;
      params.push(projectId);
    }
    sql += `
                GROUP BY w.work_date
                ORDER BY w.work_date ASC`;
    return this.db.prepare(sql).all(...params) as HeatmapRow[];
  }

  /** Snapshot of every active contract that has an end_date and/or md_limit. */
  contracts(projectId?: number): ContractsReportRow[] {
    const today = todayStr();
    const params: unknown[] = [today, today];
    let projectFilter = '';
    if (projectId !== undefined) {
      projectFilter = ' AND p.id = ?';
      params.push(projectId);
    }
    const rows = this.db
      .prepare(
        `SELECT p.id        AS project_id,
                p.name      AS project_name,
                p.color     AS project_color,
                p.archived  AS archived
           FROM projects p
           JOIN contracts pr ON pr.project_id = p.id
          WHERE p.kind = 'work'
            AND pr.effective_from <= ?
            AND (pr.end_date IS NULL OR pr.end_date >= ?)
            AND (pr.end_date IS NOT NULL OR pr.md_limit IS NOT NULL)
            AND p.deleted_at IS NULL AND pr.deleted_at IS NULL${projectFilter}
          GROUP BY p.id
          ORDER BY p.archived ASC, p.name ASC`,
      )
      .all(...params) as Array<{
        project_id: number;
        project_name: string;
        project_color: string;
        archived: number;
      }>;

    const statusService = new ContractStatusService(this.db);
    const out: ContractsReportRow[] = [];
    for (const r of rows) {
      const c = statusService.forProject(r.project_id);
      if (c) {
        out.push({
          projectId: r.project_id,
          projectName: r.project_name,
          projectColor: r.project_color,
          archived: r.archived,
          contract: c,
        });
      }
    }
    return out;
  }

  rateChanges(from: string, to: string, projectId?: number): RateChangeRow[] {
    const params: unknown[] = [from, to];
    let projectFilter = '';
    if (projectId !== undefined) {
      projectFilter = ' AND o.project_id = ?';
      params.push(projectId);
    }
    return (
      this.db
        .prepare(
          `WITH ordered AS (
             SELECT pr.project_id,
                    pr.effective_from,
                    pr.rate_type,
                    pr.rate_amount,
                    ROW_NUMBER() OVER (
                      PARTITION BY pr.project_id ORDER BY pr.effective_from
                    ) AS rn
               FROM contracts pr
              WHERE pr.deleted_at IS NULL
           )
           SELECT o.project_id,
                  p.name        AS project_name,
                  p.color       AS project_color,
                  o.effective_from,
                  o.rate_type,
                  o.rate_amount
             FROM ordered o
             JOIN projects p ON p.id = o.project_id
            WHERE o.rn > 1
              AND o.effective_from BETWEEN ? AND ?
              AND p.deleted_at IS NULL${projectFilter}
            ORDER BY o.effective_from ASC`,
        )
        .all(...params) as Array<{
          project_id: number;
          project_name: string;
          project_color: string;
          effective_from: string;
          rate_type: 'hourly' | 'daily';
          rate_amount: number;
        }>
    ).map((r) => ({
      projectId: r.project_id,
      projectName: r.project_name,
      projectColor: r.project_color,
      effectiveFrom: r.effective_from,
      rateType: r.rate_type,
      rateAmount: r.rate_amount,
    }));
  }
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
