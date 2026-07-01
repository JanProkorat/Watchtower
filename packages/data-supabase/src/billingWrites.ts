import type { DayOffRow, WorklogRow, ContractRow, TaskRow, ProjectRow } from '@watchtower/shared/billing/types.js';
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

// --- Task write-back (slice 3a) -------------------------------------------

export interface TaskWriteInput {
  epicId: number;
  number: string;
  title: string;
  status: string;
  estimatedMinutes: number | null;
  description: string | null;
}

export interface TaskInsertRow {
  sync_id: string;
  epic_id: number;
  number: string;
  title: string;
  status: string;
  estimated_minutes: number | null;
  description: string | null;
  deleted_at: null;
  updated_at: string;
}

export interface TaskUpdateRow {
  epic_id: number;
  number: string;
  title: string;
  status: string;
  estimated_minutes: number | null;
  description: string | null;
  updated_at: string;
}

export function buildTaskInsert(input: TaskWriteInput, opts: { syncId: string; now: string }): TaskInsertRow {
  return {
    sync_id: opts.syncId,
    epic_id: input.epicId,
    number: input.number,
    title: input.title,
    status: input.status,
    estimated_minutes: input.estimatedMinutes,
    description: input.description,
    deleted_at: null,
    updated_at: opts.now,
  };
}

export function buildTaskUpdate(input: TaskWriteInput, opts: { now: string }): TaskUpdateRow {
  return {
    epic_id: input.epicId,
    number: input.number,
    title: input.title,
    status: input.status,
    estimated_minutes: input.estimatedMinutes,
    description: input.description,
    updated_at: opts.now,
  };
}

export function buildTaskDelete(now: string): { deleted_at: string; updated_at: string } {
  return { deleted_at: now, updated_at: now };
}

export function buildOptimisticTaskRow(
  input: TaskWriteInput,
  opts: { syncId: string; taskId: number; project: ProjectRow },
): TaskRow {
  return {
    taskId: opts.taskId,
    syncId: opts.syncId,
    epicId: input.epicId,
    taskNumber: input.number,
    taskTitle: input.title,
    status: input.status,
    estimatedMinutes: input.estimatedMinutes,
    description: input.description,
    projectId: opts.project.id,
    projectName: opts.project.name,
    projectColor: opts.project.color,
    projectKind: opts.project.kind,
    isBillable: opts.project.isBillable,
  };
}

export function buildEditedTaskRow(existing: TaskRow, input: TaskWriteInput, project: ProjectRow): TaskRow {
  return {
    ...existing,
    epicId: input.epicId,
    taskNumber: input.number,
    taskTitle: input.title,
    status: input.status,
    estimatedMinutes: input.estimatedMinutes,
    description: input.description,
    projectId: project.id,
    projectName: project.name,
    projectColor: project.color,
    projectKind: project.kind,
    isBillable: project.isBillable,
  };
}

export type TaskChange =
  | { type: 'upsert'; row: TaskRow }
  | { type: 'remove'; syncId: string };

export function applyTaskWrite(tasks: TaskRow[], change: TaskChange): TaskRow[] {
  if (change.type === 'remove') {
    return tasks.filter((t) => t.syncId !== change.syncId);
  }
  const without = tasks.filter((t) => t.syncId !== change.row.syncId);
  return [...without, change.row];
}

/** The orchestrator locks done tasks (assertTaskNotDone); the iPad mirrors it. */
export function canEditTask(status: string): boolean {
  return status !== 'done';
}

// --- Contract write-back (slice 3b) ---------------------------------------

export interface ContractWriteInput {
  projectId: number;
  effectiveFrom: string;
  endDate: string | null;
  rateType: 'hourly' | 'daily';
  rateAmount: number;
  hoursPerDay: number;
  mdLimit: number | null;
}

export interface ContractInsertRow {
  sync_id: string;
  project_id: number;
  effective_from: string;
  rate_type: 'hourly' | 'daily';
  rate_amount: number;
  hours_per_day: number;
  end_date: string | null;
  md_limit: number | null;
  deleted_at: null;
  updated_at: string;
}

export interface ContractUpdateRow {
  effective_from: string;
  rate_type: 'hourly' | 'daily';
  rate_amount: number;
  hours_per_day: number;
  end_date: string | null;
  md_limit: number | null;
  updated_at: string;
}

export function buildContractInsert(input: ContractWriteInput, opts: { syncId: string; now: string }): ContractInsertRow {
  return {
    sync_id: opts.syncId,
    project_id: input.projectId,
    effective_from: input.effectiveFrom,
    rate_type: input.rateType,
    rate_amount: input.rateAmount,
    hours_per_day: input.hoursPerDay,
    end_date: input.endDate,
    md_limit: input.mdLimit,
    deleted_at: null,
    updated_at: opts.now,
  };
}

export function buildContractUpdate(input: ContractWriteInput, opts: { now: string }): ContractUpdateRow {
  return {
    effective_from: input.effectiveFrom,
    rate_type: input.rateType,
    rate_amount: input.rateAmount,
    hours_per_day: input.hoursPerDay,
    end_date: input.endDate,
    md_limit: input.mdLimit,
    updated_at: opts.now,
  };
}

export function buildContractEndDateUpdate(endDate: string, now: string): { end_date: string; updated_at: string } {
  return { end_date: endDate, updated_at: now };
}

export function buildContractDelete(now: string): { deleted_at: string; updated_at: string } {
  return { deleted_at: now, updated_at: now };
}

export function buildOptimisticContractRow(input: ContractWriteInput, syncId: string): ContractRow {
  return {
    syncId,
    projectId: input.projectId,
    effectiveFrom: input.effectiveFrom,
    endDate: input.endDate,
    rateType: input.rateType,
    rateAmount: input.rateAmount,
    hoursPerDay: input.hoursPerDay,
    mdLimit: input.mdLimit,
  };
}

export type ContractChange =
  | { type: 'upsert'; row: ContractRow }
  | { type: 'remove'; syncId: string };

export function applyContractWrite(contracts: ContractRow[], change: ContractChange): ContractRow[] {
  if (change.type === 'remove') {
    return contracts.filter((c) => c.syncId !== change.syncId);
  }
  const without = contracts.filter((c) => c.syncId !== change.row.syncId);
  return [...without, change.row];
}

/**
 * Recompute effectiveMinutes/earnedAmount for the given project's worklogs using
 * the provided contract set (cache-only display rebill). Other projects' worklogs
 * pass through unchanged. Mirrors the Mac deriver via the shared formula.
 */
export function rebillProjectWorklogs(worklogs: WorklogRow[], projectId: number, contracts: ContractRow[]): WorklogRow[] {
  return worklogs.map((w) => {
    if (w.projectId !== projectId) return w;
    const billing = computeDerivedForWrite(contracts, projectId, {
      minutes: w.minutes,
      reportedMinutes: w.reportedMinutes,
      workDate: w.workDate,
    });
    return { ...w, effectiveMinutes: billing.effectiveMinutes, earnedAmount: billing.earnedAmount };
  });
}
