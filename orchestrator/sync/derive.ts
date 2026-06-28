import { computeWorklogBilling, type ContractLite } from '../db/worklogBilling.js';

// Minimal shape we call on the SQLite handle (matches the project's SqliteLike).
interface SqliteLike {
  prepare(sql: string): { get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] };
}

/**
 * Per-cycle deriver for worklog rows. Resolves each worklog's project (via
 * task_sync_id → task → epic → project) and that project's contracts, both
 * cached for the push cycle, then computes the Postgres-only billing fields.
 * The raw row comes from the push SELECT (sync_id/task_sync_id/work_date/
 * minutes/reported_minutes/...).
 *
 * The SQLite table is `contracts` (renamed from `project_rates` in migration 13).
 */
export function createWorklogDeriver(db: SqliteLike) {
  const projectByTaskSyncId = new Map<string, number | null>();
  const contractsByProject = new Map<number, ContractLite[]>();

  const projectIdFor = (taskSyncId: string | null): number | null => {
    if (!taskSyncId) return null;
    if (projectByTaskSyncId.has(taskSyncId)) return projectByTaskSyncId.get(taskSyncId)!;
    const row = db.prepare(
      `SELECT e.project_id AS pid
         FROM tasks t JOIN epics e ON e.id = t.epic_id
        WHERE t.sync_id = ?`,
    ).get(taskSyncId) as { pid: number } | undefined;
    const pid = row ? row.pid : null;
    projectByTaskSyncId.set(taskSyncId, pid);
    return pid;
  };

  const contractsFor = (projectId: number): ContractLite[] => {
    if (contractsByProject.has(projectId)) return contractsByProject.get(projectId)!;
    const rows = db.prepare(
      `SELECT effective_from AS effectiveFrom, rate_type AS rateType,
              rate_amount AS rateAmount, hours_per_day AS hoursPerDay
         FROM contracts
        WHERE project_id = ? AND deleted_at IS NULL`,
    ).all(projectId) as ContractLite[];
    contractsByProject.set(projectId, rows);
    return rows;
  };

  return (row: Record<string, unknown>) => {
    const taskSyncId = (row.task_sync_id as string | null) ?? null;
    const projectId = projectIdFor(taskSyncId);
    const contracts = projectId == null ? [] : contractsFor(projectId);
    const b = computeWorklogBilling({
      minutes: Number(row.minutes),
      reportedMinutes: row.reported_minutes == null ? null : Number(row.reported_minutes),
      workDate: String(row.work_date),
      contracts,
    });
    return {
      effective_minutes: b.effectiveMinutes,
      resolved_rate: b.resolvedRate,
      earned_amount: b.earnedAmount,
    };
  };
}
