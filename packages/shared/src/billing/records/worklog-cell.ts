import type { WorklogRow } from '../types.js';

/**
 * Worklogs that a single task-grid cell aggregates. A cell is identified by
 * (projectId, taskNumber, workDate); taskNumber is normalised with `?? ''` on
 * both sides so null-task rows bucket the same way buildTaskGrid keys them.
 */
export function worklogsForCell(
  rows: WorklogRow[],
  cell: { projectId: number; taskNumber: string | null; workDate: string },
): WorklogRow[] {
  const wantTask = cell.taskNumber ?? '';
  return rows.filter(
    (r) =>
      r.projectId === cell.projectId &&
      (r.taskNumber ?? '') === wantTask &&
      r.workDate === cell.workDate,
  );
}
