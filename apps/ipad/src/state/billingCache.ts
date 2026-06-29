import type { WorklogRow, ContractRow, DayOffRow, ProjectRow, TaskRow, EpicRow } from '@watchtower/shared/billing/types.js';

// ---------------------------------------------------------------------------
// Dataset type
// ---------------------------------------------------------------------------

export interface BillingDataset {
  worklogs: WorklogRow[];
  contracts: ContractRow[];
  daysOff: DayOffRow[];
  projects: ProjectRow[];
  tasks: TaskRow[];
  epics: EpicRow[];
  fetchedAt: string; // ISO timestamp
}

// ---------------------------------------------------------------------------
// Store interface — mirrors the pattern in vncCreds.ts (ConnStore)
// Capacitor Preferences in production; a plain Map in tests.
// ---------------------------------------------------------------------------

export interface BillingStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Pure mapper — PostgREST embedded shape → WorklogRow
//
// Embedded select:
//   worklogs?select=sync_id,work_date,minutes,effective_minutes,earned_amount,source,
//                   tasks(number,title,epics(projects(id,name,color,kind,is_billable)))
// ---------------------------------------------------------------------------

type RawProject = {
  id: number;
  name: string;
  color: string | null;
  kind: string;
  is_billable: boolean;
};

type RawEpic = { projects: RawProject | null };
type RawTask = { number: string | null; title: string | null; epics: RawEpic | null } | null;

export type RawWorklogRow = {
  sync_id: string;
  work_date: string;
  minutes: number;
  effective_minutes: number;
  earned_amount: number | null;
  reported_minutes: number | null;
  description: string | null;
  source: string | null;
  tasks: RawTask;
};

export function mapWorklogRow(raw: RawWorklogRow): WorklogRow {
  const task = raw.tasks ?? null;
  const proj = task?.epics?.projects ?? null;

  return {
    syncId: raw.sync_id,
    workDate: raw.work_date,
    minutes: raw.minutes,
    reportedMinutes: raw.reported_minutes ?? null,
    effectiveMinutes: raw.effective_minutes,
    earnedAmount: raw.earned_amount,
    description: raw.description ?? null,
    projectId: proj?.id ?? 0,
    projectName: proj?.name ?? '',
    projectColor: proj?.color ?? null,
    projectKind: proj?.kind ?? '',
    isBillable: proj?.is_billable ?? false,
    taskNumber: task?.number ?? null,
    taskTitle: task?.title ?? null,
    source: raw.source ?? null,
  };
}

// ---------------------------------------------------------------------------
// Pure mapper — PostgREST embedded shape → TaskRow
// ---------------------------------------------------------------------------

export type RawTaskRow = {
  id: number;
  sync_id: string;
  epic_id: number;
  number: string | null;
  title: string | null;
  status: string;
  estimated_minutes: number | null;
  description: string | null;
  epics: { projects: RawProject | null } | null;
};

export function mapTaskRow(raw: RawTaskRow): TaskRow {
  const proj = raw.epics?.projects ?? null;
  return {
    taskId: raw.id,
    syncId: raw.sync_id,
    epicId: raw.epic_id,
    taskNumber: raw.number ?? null,
    taskTitle: raw.title ?? '',
    status: raw.status,
    estimatedMinutes: raw.estimated_minutes ?? null,
    description: raw.description ?? null,
    projectId: proj?.id ?? 0,
    projectName: proj?.name ?? '',
    projectColor: proj?.color ?? null,
    projectKind: proj?.kind ?? '',
    isBillable: proj?.is_billable ?? false,
  };
}

export type RawEpicRow = { id: number; name: string; project_id: number; status: string };

export function mapEpicRow(raw: RawEpicRow): EpicRow {
  return { epicId: raw.id, name: raw.name, projectId: raw.project_id, status: raw.status };
}

// ---------------------------------------------------------------------------
// Pure mapper — PostgREST raw days_off row → DayOffRow
// ---------------------------------------------------------------------------

export type RawDayOffRow = { date: string; kind: string; sync_id: string };

export function mapDayOffRow(raw: RawDayOffRow): DayOffRow {
  return { date: raw.date, kind: raw.kind, syncId: raw.sync_id };
}

// ---------------------------------------------------------------------------
// Pure mapper — PostgREST raw contracts row → ContractRow
// ---------------------------------------------------------------------------

export type RawContractRow = {
  sync_id: string;
  project_id: number;
  effective_from: string;
  end_date: string | null;
  rate_type: 'hourly' | 'daily';
  rate_amount: number;
  hours_per_day: number;
  md_limit: number | null;
};

export function mapContractRow(raw: RawContractRow): ContractRow {
  return {
    syncId: raw.sync_id,
    projectId: raw.project_id,
    effectiveFrom: raw.effective_from,
    endDate: raw.end_date ?? null,
    rateType: raw.rate_type,
    rateAmount: raw.rate_amount,
    hoursPerDay: raw.hours_per_day,
    mdLimit: raw.md_limit ?? null,
  };
}

// ---------------------------------------------------------------------------
// Cache persistence — key for Capacitor Preferences
// ---------------------------------------------------------------------------

const CACHE_KEY = 'watchtower.ipad.billing.cache';

export async function loadCache(store: BillingStore): Promise<BillingDataset | null> {
  const raw = await store.get(CACHE_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as BillingDataset;
    // Minimal shape validation
    if (
      Array.isArray(v?.worklogs) &&
      Array.isArray(v?.contracts) &&
      Array.isArray(v?.daysOff) &&
      Array.isArray(v?.projects) &&
      Array.isArray(v?.tasks) &&
      Array.isArray(v?.epics) &&
      typeof v?.fetchedAt === 'string'
    ) {
      return v;
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveCache(store: BillingStore, dataset: BillingDataset): Promise<void> {
  await store.set(CACHE_KEY, JSON.stringify(dataset));
}
