import type { SqliteLike } from './migrations.js';

/**
 * Mark worklogs for re-push after a contract/rate change. Bumps `updated_at`
 * (the push cursor key) on every non-deleted worklog of `projectId` whose
 * `work_date >= fromDate`, so the next sync re-derives their billing fields.
 * Returns the number of rows touched.
 */
export function markWorklogsForRebill(
  db: SqliteLike,
  projectId: number,
  fromDate: string,
  nowIso: string,
): number {
  const res = db.prepare(
    `UPDATE worklogs
        SET updated_at = ?
      WHERE deleted_at IS NULL
        AND work_date >= ?
        AND task_id IN (
          SELECT t.id FROM tasks t JOIN epics e ON e.id = t.epic_id
           WHERE e.project_id = ?
        )`,
  ).run(nowIso, fromDate, projectId) as { changes: number | bigint };
  return Number(res.changes);
}
