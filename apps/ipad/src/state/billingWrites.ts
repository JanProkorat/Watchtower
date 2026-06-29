import type { DayOffRow, WorklogRow, ContractRow, TaskRow } from '@watchtower/shared/billing/types.js';
import { computeWorklogBilling, type ContractLite, type WorklogBilling } from '@watchtower/shared/billing/worklogBilling.js';
import type { BillingState } from './useBilling.js';

export interface DayOffUpsertRow {
  sync_id: string;
  date: string;
  kind: string;
  note: null;
  deleted_at: null;
  updated_at: string;
}

export function buildDayOffUpsert(
  date: string,
  kind: string,
  opts: { syncId: string; now: string },
): DayOffUpsertRow {
  return { sync_id: opts.syncId, date, kind, note: null, deleted_at: null, updated_at: opts.now };
}

export function buildDayOffDelete(now: string): { deleted_at: string; updated_at: string } {
  return { deleted_at: now, updated_at: now };
}

export type DayOffChange =
  | { type: 'set'; row: DayOffRow }
  | { type: 'clear'; date: string };

export function applyDayOffWrite(daysOff: DayOffRow[], change: DayOffChange): DayOffRow[] {
  if (change.type === 'clear') {
    return daysOff.filter((d) => d.date !== change.date);
  }
  const without = daysOff.filter((d) => d.date !== change.row.date);
  return [...without, change.row];
}

/** Online-direct: only a fresh (live) dataset is editable; offline/cached/loading is read-only. */
export function canEdit(state: BillingState): boolean {
  return state === 'fresh';
}

// --- Worklog write-back (slice 2) -----------------------------------------

export interface WorklogWriteInput {
  taskId: number;
  workDate: string;
  minutes: number;
  reportedMinutes: number | null;
  description: string | null;
}

export interface WorklogInsertRow {
  sync_id: string;
  task_id: number;
  work_date: string;
  minutes: number;
  reported_minutes: number | null;
  description: string | null;
  source: 'manual';
  external_id: null;
  jira_uploaded: false;
  deleted_at: null;
  updated_at: string;
  effective_minutes: number;
  resolved_rate: number | null;
  earned_amount: number | null;
}

export interface WorklogUpdateRow {
  work_date: string;
  minutes: number;
  reported_minutes: number | null;
  description: string | null;
  updated_at: string;
  effective_minutes: number;
  resolved_rate: number | null;
  earned_amount: number | null;
}

/** Derive billing fields for a write, using the same shared formula the Mac uses. */
export function computeDerivedForWrite(
  contracts: ContractRow[],
  projectId: number,
  input: { minutes: number; reportedMinutes: number | null; workDate: string },
): WorklogBilling {
  const lite: ContractLite[] = contracts
    .filter((c) => c.projectId === projectId)
    .map((c) => ({ effectiveFrom: c.effectiveFrom, rateType: c.rateType, rateAmount: c.rateAmount, hoursPerDay: c.hoursPerDay }));
  return computeWorklogBilling({ minutes: input.minutes, reportedMinutes: input.reportedMinutes, workDate: input.workDate, contracts: lite });
}

export function buildWorklogInsert(
  input: WorklogWriteInput,
  opts: { syncId: string; now: string; billing: WorklogBilling },
): WorklogInsertRow {
  return {
    sync_id: opts.syncId,
    task_id: input.taskId,
    work_date: input.workDate,
    minutes: input.minutes,
    reported_minutes: input.reportedMinutes,
    description: input.description,
    source: 'manual',
    external_id: null,
    jira_uploaded: false,
    deleted_at: null,
    updated_at: opts.now,
    effective_minutes: opts.billing.effectiveMinutes,
    resolved_rate: opts.billing.resolvedRate,
    earned_amount: opts.billing.earnedAmount,
  };
}

export function buildWorklogUpdate(
  input: { workDate: string; minutes: number; reportedMinutes: number | null; description: string | null },
  opts: { now: string; billing: WorklogBilling },
): WorklogUpdateRow {
  return {
    work_date: input.workDate,
    minutes: input.minutes,
    reported_minutes: input.reportedMinutes,
    description: input.description,
    updated_at: opts.now,
    effective_minutes: opts.billing.effectiveMinutes,
    resolved_rate: opts.billing.resolvedRate,
    earned_amount: opts.billing.earnedAmount,
  };
}

export function buildWorklogDelete(now: string): { deleted_at: string; updated_at: string } {
  return { deleted_at: now, updated_at: now };
}

export function buildOptimisticWorklogRow(
  task: TaskRow,
  input: WorklogWriteInput,
  billing: WorklogBilling,
  syncId: string,
): WorklogRow {
  return {
    syncId,
    workDate: input.workDate,
    minutes: input.minutes,
    reportedMinutes: input.reportedMinutes,
    effectiveMinutes: billing.effectiveMinutes,
    earnedAmount: billing.earnedAmount,
    description: input.description,
    projectId: task.projectId,
    projectName: task.projectName,
    projectColor: task.projectColor,
    projectKind: task.projectKind,
    isBillable: task.isBillable,
    taskNumber: task.taskNumber,
    taskTitle: task.taskTitle,
    source: 'manual',
  };
}

export function buildEditedWorklogRow(
  existing: WorklogRow,
  input: { workDate: string; minutes: number; reportedMinutes: number | null; description: string | null },
  billing: WorklogBilling,
): WorklogRow {
  return {
    ...existing,
    workDate: input.workDate,
    minutes: input.minutes,
    reportedMinutes: input.reportedMinutes,
    description: input.description,
    effectiveMinutes: billing.effectiveMinutes,
    earnedAmount: billing.earnedAmount,
  };
}

export type WorklogChange =
  | { type: 'upsert'; row: WorklogRow }
  | { type: 'remove'; syncId: string };

export function applyWorklogWrite(worklogs: WorklogRow[], change: WorklogChange): WorklogRow[] {
  if (change.type === 'remove') {
    return worklogs.filter((w) => w.syncId !== change.syncId);
  }
  const without = worklogs.filter((w) => w.syncId !== change.row.syncId);
  return [...without, change.row];
}
