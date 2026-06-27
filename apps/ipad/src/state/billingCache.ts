import type { WorklogRow, ContractRow, DayOffRow, ProjectRow } from '@watchtower/shared/billing/types.js';

// ---------------------------------------------------------------------------
// Dataset type
// ---------------------------------------------------------------------------

export interface BillingDataset {
  worklogs: WorklogRow[];
  contracts: ContractRow[];
  daysOff: DayOffRow[];
  projects: ProjectRow[];
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
//   worklogs?select=sync_id,work_date,minutes,effective_minutes,earned_amount,
//                   rate_currency,tasks(number,title,epics(projects(id,name,color,kind,is_billable)))
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
  rate_currency: string | null;
  tasks: RawTask;
};

export function mapWorklogRow(raw: RawWorklogRow): WorklogRow {
  const task = raw.tasks ?? null;
  const proj = task?.epics?.projects ?? null;

  return {
    syncId: raw.sync_id,
    workDate: raw.work_date,
    minutes: raw.minutes,
    effectiveMinutes: raw.effective_minutes,
    earnedAmount: raw.earned_amount,
    rateCurrency: raw.rate_currency,
    projectId: proj?.id ?? 0,
    projectName: proj?.name ?? '',
    projectColor: proj?.color ?? null,
    projectKind: proj?.kind ?? '',
    isBillable: proj?.is_billable ?? false,
    taskNumber: task?.number ?? null,
    taskTitle: task?.title ?? null,
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
