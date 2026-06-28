/**
 * Shared SQL fragments for reports + the task grid.
 *
 * `EFFECTIVE_MINUTES` collapses tracked vs reported into the canonical
 * "what counts" value per row (reported wins; tracked is the fallback).
 * `PROJECT_RATE_PERIODS_CTE` + `RATE_PERIOD_JOIN` resolve each worklog to
 * the rate row that contains its `work_date`. `SUM_EARNED` sums earnings
 * across many rows that may straddle multiple rate periods.
 *
 * Ported verbatim from TimeTracker's `server/sql.ts` + `server/rateSql.ts`
 * per the absorption decision.
 */

export function effectiveMinutes(alias: string = 'w'): string {
  const prefix = alias ? `${alias}.` : '';
  return `COALESCE(${prefix}reported_minutes, ${prefix}minutes)`;
}

export const EFFECTIVE_MINUTES = effectiveMinutes('w');

/**
 * Per-row man-day value: effective minutes converted to MD using the rate
 * period's `hours_per_day` (resolved via `RATE_PERIOD_JOIN`), falling back to
 * the conventional 8h day when a worklog has no matching rate period. Wrap in
 * `SUM(...)` to aggregate; `SUM_MDS` is the ready-made aggregate form.
 */
export function mdPerRow(rateAlias: string = 'rp'): string {
  return `${EFFECTIVE_MINUTES} / 60.0 / COALESCE(${rateAlias}.hours_per_day, 8.0)`;
}

export const SUM_MDS = `SUM(${mdPerRow('rp')})`;

export const PROJECT_RATE_PERIODS_CTE = `
  project_rate_periods AS (
    SELECT pr.id,
           pr.project_id,
           pr.effective_from,
           pr.rate_type,
           pr.rate_amount,
           pr.hours_per_day,
           LEAD(pr.effective_from) OVER (
             PARTITION BY pr.project_id ORDER BY pr.effective_from
           ) AS effective_to_exclusive
    FROM contracts pr
    WHERE pr.deleted_at IS NULL
  )
`;

export const RATE_PERIOD_JOIN = `
  LEFT JOIN project_rate_periods rp
    ON rp.project_id = p.id
   AND rp.effective_from <= w.work_date
   AND (rp.effective_to_exclusive IS NULL
        OR rp.effective_to_exclusive > w.work_date)
`;

export const SUM_EARNED = `
  SUM(
    CASE
      WHEN rp.rate_amount IS NOT NULL THEN
        CASE rp.rate_type
          WHEN 'hourly' THEN ${EFFECTIVE_MINUTES} * rp.rate_amount / 60.0
          WHEN 'daily'  THEN ${EFFECTIVE_MINUTES} / 60.0 / rp.hours_per_day * rp.rate_amount
          ELSE NULL
        END
      ELSE NULL
    END
  )
`;
