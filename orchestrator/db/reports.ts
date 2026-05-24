import type { SqliteLike } from './migrations.js';
import {
  EFFECTIVE_MINUTES,
  PROJECT_RATE_PERIODS_CTE,
  RATE_PERIOD_JOIN,
  SUM_EARNED,
  effectiveMinutes,
} from './reportsSql.js';
import { ContractStatusService, type ContractStatus } from './contractStatus.js';

export type Granularity = 'day' | 'week' | 'month';

export interface TrendRow {
  bucket: string;
  minutes: number;
  earnedByCurrency: Record<string, number>;
}

export interface ByProjectRow {
  projectId: number;
  projectName: string;
  projectColor: string;
  isBillable: number;
  currency: string | null;
  minutes: number;
  earnedAmount: number | null;
}

export interface EarningsByProjectRow {
  project_id: number;
  project_name: string;
  project_color: string;
  currency: string | null;
  minutes: number;
  earned_amount: number | null;
}

export interface EarningsResponse {
  billableMinutes: number;
  unbillableMinutes: number;
  timeOffMinutes: number;
  totalEarned: Record<string, number>;
  avgEffectiveHourlyRate: Record<string, number>;
  byProject: EarningsByProjectRow[];
}

export interface HeatmapRow {
  date: string;
  minutes: number;
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
  currency: string;
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

  trend(from: string, to: string, granularity: Granularity): TrendRow[] {
    const bucketExpr = BUCKET_EXPR[granularity];

    const totals = this.db
      .prepare(
        `SELECT ${bucketExpr} AS bucket,
                SUM(${EFFECTIVE_MINUTES}) AS minutes
           FROM worklogs w
          WHERE w.work_date BETWEEN ? AND ?
          GROUP BY bucket
          ORDER BY bucket ASC`,
      )
      .all(from, to) as Array<{ bucket: string; minutes: number }>;

    const earnings = this.db
      .prepare(
        `WITH ${PROJECT_RATE_PERIODS_CTE}
         SELECT ${bucketExpr} AS bucket,
                rp.currency   AS currency,
                ${SUM_EARNED} AS earned
           FROM worklogs w
           JOIN tasks t    ON t.id = w.task_id
           JOIN epics e    ON e.id = t.epic_id
           JOIN projects p ON p.id = e.project_id
           ${RATE_PERIOD_JOIN}
          WHERE w.work_date BETWEEN ? AND ?
            AND p.is_billable = 1
            AND rp.rate_amount IS NOT NULL
          GROUP BY bucket, rp.currency
          ORDER BY bucket ASC`,
      )
      .all(from, to) as Array<{ bucket: string; currency: string; earned: number }>;

    const earnedByBucket = new Map<string, Record<string, number>>();
    for (const row of earnings) {
      const bucket = earnedByBucket.get(row.bucket) ?? {};
      bucket[row.currency] = row.earned;
      earnedByBucket.set(row.bucket, bucket);
    }

    return totals.map((r) => ({
      bucket: r.bucket,
      minutes: r.minutes,
      earnedByCurrency: earnedByBucket.get(r.bucket) ?? {},
    }));
  }

  byProject(from: string, to: string): ByProjectRow[] {
    const rows = this.db
      .prepare(
        `WITH ${PROJECT_RATE_PERIODS_CTE}
         SELECT p.id            AS project_id,
                p.name          AS project_name,
                p.color         AS project_color,
                p.is_billable   AS is_billable,
                (SELECT pr.currency
                   FROM project_rates pr
                  WHERE pr.project_id = p.id
                  ORDER BY pr.effective_from DESC
                  LIMIT 1)      AS currency,
                COALESCE(SUM(${EFFECTIVE_MINUTES}), 0) AS minutes,
                CASE
                  WHEN p.is_billable = 1 THEN ${SUM_EARNED}
                  ELSE NULL
                END             AS earned_amount
           FROM projects p
           LEFT JOIN epics e    ON e.project_id = p.id
           LEFT JOIN tasks t    ON t.epic_id    = e.id
           LEFT JOIN worklogs w ON w.task_id    = t.id
                                AND w.work_date BETWEEN ? AND ?
           ${RATE_PERIOD_JOIN}
          GROUP BY p.id
          HAVING minutes > 0
          ORDER BY minutes DESC`,
      )
      .all(from, to) as Array<{
        project_id: number;
        project_name: string;
        project_color: string;
        is_billable: number;
        currency: string | null;
        minutes: number;
        earned_amount: number | null;
      }>;

    return rows.map((r) => ({
      projectId: r.project_id,
      projectName: r.project_name,
      projectColor: r.project_color,
      isBillable: r.is_billable,
      currency: r.currency,
      minutes: r.minutes,
      earnedAmount: r.earned_amount,
    }));
  }

  earnings(from: string, to: string): EarningsResponse {
    const totals = this.db
      .prepare(
        `SELECT
            SUM(CASE WHEN p.kind = 'work' AND p.is_billable = 1 THEN ${EFFECTIVE_MINUTES} ELSE 0 END) AS billable_minutes,
            SUM(CASE WHEN p.kind = 'work' AND p.is_billable = 0 THEN ${EFFECTIVE_MINUTES} ELSE 0 END) AS unbillable_minutes,
            SUM(CASE WHEN p.kind = 'time_off' THEN ${EFFECTIVE_MINUTES} ELSE 0 END) AS time_off_minutes
           FROM worklogs w
           JOIN tasks t    ON t.id = w.task_id
           JOIN epics e    ON e.id = t.epic_id
           JOIN projects p ON p.id = e.project_id
          WHERE w.work_date BETWEEN ? AND ?`,
      )
      .get(from, to) as {
        billable_minutes: number | null;
        unbillable_minutes: number | null;
        time_off_minutes: number | null;
      };

    const earnedByCurrency = this.db
      .prepare(
        `WITH ${PROJECT_RATE_PERIODS_CTE}
         SELECT rp.currency AS currency,
                ${SUM_EARNED} AS earned,
                SUM(${EFFECTIVE_MINUTES}) AS billable_minutes
           FROM worklogs w
           JOIN tasks t    ON t.id = w.task_id
           JOIN epics e    ON e.id = t.epic_id
           JOIN projects p ON p.id = e.project_id
           ${RATE_PERIOD_JOIN}
          WHERE w.work_date BETWEEN ? AND ?
            AND p.is_billable = 1
            AND rp.rate_amount IS NOT NULL
          GROUP BY rp.currency`,
      )
      .all(from, to) as Array<{ currency: string; earned: number; billable_minutes: number }>;

    const byProject = this.db
      .prepare(
        `WITH ${PROJECT_RATE_PERIODS_CTE}
         SELECT p.id           AS project_id,
                p.name         AS project_name,
                p.color        AS project_color,
                MAX(rp.currency) AS currency,
                SUM(${EFFECTIVE_MINUTES}) AS minutes,
                ${SUM_EARNED} AS earned_amount
           FROM worklogs w
           JOIN tasks t    ON t.id = w.task_id
           JOIN epics e    ON e.id = t.epic_id
           JOIN projects p ON p.id = e.project_id
           ${RATE_PERIOD_JOIN}
          WHERE w.work_date BETWEEN ? AND ?
            AND p.is_billable = 1
            AND rp.rate_amount IS NOT NULL
          GROUP BY p.id
          ORDER BY earned_amount DESC`,
      )
      .all(from, to) as EarningsByProjectRow[];

    const total_earned: Record<string, number> = {};
    const avg_effective_hourly_rate: Record<string, number> = {};
    for (const row of earnedByCurrency) {
      total_earned[row.currency] = row.earned;
      if (row.billable_minutes > 0) {
        avg_effective_hourly_rate[row.currency] = row.earned / (row.billable_minutes / 60);
      }
    }

    return {
      billableMinutes: totals.billable_minutes ?? 0,
      unbillableMinutes: totals.unbillable_minutes ?? 0,
      timeOffMinutes: totals.time_off_minutes ?? 0,
      totalEarned: total_earned,
      avgEffectiveHourlyRate: avg_effective_hourly_rate,
      byProject,
    };
  }

  heatmap(from: string, to: string): HeatmapRow[] {
    return this.db
      .prepare(
        `SELECT work_date AS date,
                SUM(${effectiveMinutes('')}) AS minutes
           FROM worklogs
          WHERE work_date BETWEEN ? AND ?
          GROUP BY work_date
          ORDER BY work_date ASC`,
      )
      .all(from, to) as HeatmapRow[];
  }

  /** Snapshot of every active contract that has an end_date and/or md_limit. */
  contracts(): ContractsReportRow[] {
    const today = todayStr();
    const rows = this.db
      .prepare(
        `SELECT p.id        AS project_id,
                p.name      AS project_name,
                p.color     AS project_color,
                p.archived  AS archived
           FROM projects p
           JOIN project_rates pr ON pr.project_id = p.id
          WHERE p.kind = 'work'
            AND pr.effective_from <= ?
            AND (pr.end_date IS NULL OR pr.end_date >= ?)
            AND (pr.end_date IS NOT NULL OR pr.md_limit IS NOT NULL)
          GROUP BY p.id
          ORDER BY p.archived ASC, p.name ASC`,
      )
      .all(today, today) as Array<{
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

  rateChanges(from: string, to: string): RateChangeRow[] {
    return (
      this.db
        .prepare(
          `WITH ordered AS (
             SELECT pr.project_id,
                    pr.effective_from,
                    pr.rate_type,
                    pr.rate_amount,
                    pr.currency,
                    ROW_NUMBER() OVER (
                      PARTITION BY pr.project_id ORDER BY pr.effective_from
                    ) AS rn
               FROM project_rates pr
           )
           SELECT o.project_id,
                  p.name        AS project_name,
                  p.color       AS project_color,
                  o.effective_from,
                  o.rate_type,
                  o.rate_amount,
                  o.currency
             FROM ordered o
             JOIN projects p ON p.id = o.project_id
            WHERE o.rn > 1
              AND o.effective_from BETWEEN ? AND ?
            ORDER BY o.effective_from ASC`,
        )
        .all(from, to) as Array<{
          project_id: number;
          project_name: string;
          project_color: string;
          effective_from: string;
          rate_type: 'hourly' | 'daily';
          rate_amount: number;
          currency: string;
        }>
    ).map((r) => ({
      projectId: r.project_id,
      projectName: r.project_name,
      projectColor: r.project_color,
      effectiveFrom: r.effective_from,
      rateType: r.rate_type,
      rateAmount: r.rate_amount,
      currency: r.currency,
    }));
  }
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
