import { describe, it, expect } from 'vitest';
import {
  mapWorklogRow,
  mapDayOffRow,
  mapTaskRow,
  mapEpicRow,
  loadCache,
  saveCache,
  type BillingDataset,
  type RawWorklogRow,
  type RawEpicRow,
} from '@watchtower/data-supabase';
import type { RawTaskRow } from '@watchtower/data-supabase';
import type { ContractRow, DayOffRow, ProjectRow, WorklogRow } from '@watchtower/shared/billing/types.js';

// ---------------------------------------------------------------------------
// In-memory store (same pattern as vncCreds.test.ts)
// ---------------------------------------------------------------------------

function memStore() {
  const mem = new Map<string, string>();
  return {
    get: async (k: string) => mem.get(k) ?? null,
    set: async (k: string, v: string) => { mem.set(k, v); },
  };
}

// ---------------------------------------------------------------------------
// mapWorklogRow — full task + project
// ---------------------------------------------------------------------------

describe('mapWorklogRow', () => {
  const fullRaw: RawWorklogRow = {
    sync_id: 'abc-123',
    work_date: '2026-06-01',
    minutes: 480,
    effective_minutes: 450,
    earned_amount: 5000,
    tasks: {
      number: 'WT-42',
      title: 'Fix billing bug',
      epics: {
        projects: {
          id: 7,
          name: 'Watchtower',
          color: '#7c3aed',
          kind: 'work',
          is_billable: true,
        },
      },
    },
  };

  it('maps all fields from an embedded PostgREST row', () => {
    const row: WorklogRow = mapWorklogRow(fullRaw);
    expect(row.syncId).toBe('abc-123');
    expect(row.workDate).toBe('2026-06-01');
    expect(row.minutes).toBe(480);
    expect(row.effectiveMinutes).toBe(450);
    expect(row.earnedAmount).toBe(5000);
    expect(row.projectId).toBe(7);
    expect(row.projectName).toBe('Watchtower');
    expect(row.projectColor).toBe('#7c3aed');
    expect(row.projectKind).toBe('work');
    expect(row.isBillable).toBe(true);
    expect(row.taskNumber).toBe('WT-42');
    expect(row.taskTitle).toBe('Fix billing bug');
  });

  it('handles null tasks — project fields default to empty/0/false, task fields to null', () => {
    const rawNoTask: RawWorklogRow = { ...fullRaw, tasks: null };
    const row = mapWorklogRow(rawNoTask);
    expect(row.projectId).toBe(0);
    expect(row.projectName).toBe('');
    expect(row.projectColor).toBeNull();
    expect(row.projectKind).toBe('');
    expect(row.isBillable).toBe(false);
    expect(row.taskNumber).toBeNull();
    expect(row.taskTitle).toBeNull();
  });

  it('handles tasks with null epics', () => {
    const rawNullEpics: RawWorklogRow = {
      ...fullRaw,
      tasks: { number: 'WT-1', title: 'Orphan task', epics: null },
    };
    const row = mapWorklogRow(rawNullEpics);
    expect(row.projectId).toBe(0);
    expect(row.projectName).toBe('');
    expect(row.taskNumber).toBe('WT-1');
    expect(row.taskTitle).toBe('Orphan task');
  });

  it('handles tasks with null project inside epics', () => {
    const rawNullProject: RawWorklogRow = {
      ...fullRaw,
      tasks: { number: 'WT-2', title: 'No proj task', epics: { projects: null } },
    };
    const row = mapWorklogRow(rawNullProject);
    expect(row.projectId).toBe(0);
    expect(row.isBillable).toBe(false);
    expect(row.taskNumber).toBe('WT-2');
  });

  it('passes through earnedAmount', () => {
    const rawEur: RawWorklogRow = { ...fullRaw, earned_amount: 200 };
    const row = mapWorklogRow(rawEur);
    expect(row.earnedAmount).toBe(200);
  });

  it('passes through null earnedAmount', () => {
    const rawNull: RawWorklogRow = { ...fullRaw, earned_amount: null };
    const row = mapWorklogRow(rawNull);
    expect(row.earnedAmount).toBeNull();
  });
});

describe('mapWorklogRow source', () => {
  const base = {
    sync_id: 's1', work_date: '2026-06-01', minutes: 60, effective_minutes: 60,
    earned_amount: 1000,
    tasks: { number: 'X-1', title: 'T', epics: { projects: { id: 1, name: 'P', color: '#fff', kind: 'work', is_billable: true } } },
  };

  it('maps the source field', () => {
    expect(mapWorklogRow({ ...base, source: 'jira-sync' } as never).source).toBe('jira-sync');
  });

  it('defaults a missing source to null', () => {
    expect(mapWorklogRow(base as never).source).toBeNull();
  });
});

describe('mapDayOffRow', () => {
  it('maps date, kind, and sync_id', () => {
    expect(mapDayOffRow({ date: '2026-07-06', kind: 'vacation', sync_id: 'abc' } as never))
      .toEqual({ date: '2026-07-06', kind: 'vacation', syncId: 'abc' });
  });
});

// ---------------------------------------------------------------------------
// loadCache / saveCache round-trip
// ---------------------------------------------------------------------------

describe('billing cache persistence', () => {
  const sampleDataset: BillingDataset = {
    worklogs: [],
    contracts: [],
    daysOff: [],
    projects: [],
    tasks: [],
    epics: [],
    fetchedAt: '2026-06-26T12:00:00.000Z',
  };

  it('round-trips a BillingDataset through the store', async () => {
    const store = memStore();
    await saveCache(store, sampleDataset);
    const loaded = await loadCache(store);
    expect(loaded).toEqual(sampleDataset);
  });

  it('returns null when nothing is stored', async () => {
    const store = { get: async () => null, set: async () => {} };
    expect(await loadCache(store)).toBeNull();
  });

  it('returns null on malformed JSON', async () => {
    const store = { get: async () => 'not json', set: async () => {} };
    expect(await loadCache(store)).toBeNull();
  });

  it('returns null when required arrays are missing', async () => {
    const bad = JSON.stringify({ worklogs: [], contracts: [] }); // missing daysOff, projects, fetchedAt
    const store = { get: async () => bad, set: async () => {} };
    expect(await loadCache(store)).toBeNull();
  });

  it('round-trips a dataset with populated worklogs and projects', async () => {
    const store = memStore();
    const worklog: WorklogRow = {
      syncId: 'x1',
      workDate: '2026-06-10',
      minutes: 120,
      reportedMinutes: null,
      effectiveMinutes: 100,
      earnedAmount: 1000,
      description: null,
      projectId: 3,
      projectName: 'Test',
      projectColor: null,
      projectKind: 'work',
      isBillable: true,
      taskNumber: null,
      taskTitle: null,
      source: null,
    };
    const contract: ContractRow = {
      syncId: 'c-test',
      projectId: 3,
      effectiveFrom: '2026-01-01',
      endDate: null,
      rateType: 'hourly',
      rateAmount: 1000,
      hoursPerDay: 8,
      mdLimit: null,
    };
    const dayOff: DayOffRow = { date: '2026-06-09', kind: 'vacation' };
    const project: ProjectRow = { id: 3, name: 'Test', color: null, kind: 'work', isBillable: true };
    const full: BillingDataset = {
      worklogs: [worklog],
      contracts: [contract],
      daysOff: [dayOff],
      projects: [project],
      tasks: [],
      epics: [],
      fetchedAt: '2026-06-26T14:00:00.000Z',
    };
    await saveCache(store, full);
    expect(await loadCache(store)).toEqual(full);
  });
});

describe('mapWorklogRow — slice 2 fields', () => {
  it('maps reported_minutes and description', () => {
    const row = mapWorklogRow({
      sync_id: 'w1', work_date: '2026-06-01', minutes: 120, effective_minutes: 90,
      earned_amount: 150, reported_minutes: 90, description: 'fix bug', source: 'manual',
      tasks: { number: 'X-1', title: 'T', epics: { projects: { id: 3, name: 'P', color: '#fff', kind: 'work', is_billable: true } } },
    });
    expect(row.reportedMinutes).toBe(90);
    expect(row.description).toBe('fix bug');
  });
  it('defaults reported_minutes/description to null', () => {
    const row = mapWorklogRow({
      sync_id: 'w2', work_date: '2026-06-01', minutes: 60, effective_minutes: 60,
      earned_amount: null, reported_minutes: null, description: null, source: null, tasks: null,
    });
    expect(row.reportedMinutes).toBeNull();
    expect(row.description).toBeNull();
  });
});

describe('mapTaskRow', () => {
  it('flattens task → epic → project', () => {
    const raw: RawTaskRow = {
      id: 7, sync_id: 't-1', epic_id: 5, number: 'X-9', title: 'Task nine',
      status: 'open', estimated_minutes: null, jira_estimate_secs: null, jira_status: null, description: null,
      epics: { projects: { id: 3, name: 'Proj', color: '#abc', kind: 'work', is_billable: true } },
    };
    expect(mapTaskRow(raw)).toEqual({
      taskId: 7, syncId: 't-1', epicId: 5, taskNumber: 'X-9', taskTitle: 'Task nine',
      status: 'open', estimatedMinutes: null, description: null,
      projectId: 3, projectName: 'Proj', projectColor: '#abc', projectKind: 'work', isBillable: true,
      jiraStatus: null,
    });
  });
});

describe('loadCache — slice 2 shape guard', () => {
  it('rejects a cache without a tasks array (forces refetch)', async () => {
    const store = new Map<string, string>();
    const legacy = { worklogs: [], contracts: [], daysOff: [], projects: [], fetchedAt: '2026-06-01T00:00:00Z' };
    store.set('watchtower.ipad.billing.cache', JSON.stringify(legacy));
    const adapter = { get: async (k: string) => store.get(k) ?? null, set: async () => {} };
    expect(await loadCache(adapter)).toBeNull();
  });
});

describe('mapEpicRow', () => {
  it('maps a raw epic row', () => {
    const raw: RawEpicRow = { id: 5, name: 'Sprint 1', project_id: 3, status: 'active' };
    expect(mapEpicRow(raw)).toEqual({ epicId: 5, name: 'Sprint 1', projectId: 3, status: 'active' });
  });
});

describe('mapTaskRow — slice 3a fields', () => {
  it('maps syncId/epicId/status/estimatedMinutes/description/jiraStatus', () => {
    const raw: RawTaskRow = {
      id: 7, sync_id: 't-sync', epic_id: 5, number: 'X-9', title: 'Task nine',
      status: 'in_progress', estimated_minutes: 120, jira_estimate_secs: null, jira_status: 'In Progress', description: 'do it',
      epics: { projects: { id: 3, name: 'Proj', color: '#abc', kind: 'work', is_billable: true } },
    };
    expect(mapTaskRow(raw)).toEqual({
      taskId: 7, syncId: 't-sync', epicId: 5, taskNumber: 'X-9', taskTitle: 'Task nine',
      status: 'in_progress', estimatedMinutes: 120, description: 'do it',
      projectId: 3, projectName: 'Proj', projectColor: '#abc', projectKind: 'work', isBillable: true,
      jiraStatus: 'In Progress',
    });
  });
  it('defaults estimatedMinutes/description to null and status to empty', () => {
    const raw: RawTaskRow = {
      id: 8, sync_id: 's8', epic_id: 1, number: null, title: null,
      status: 'open', estimated_minutes: null, jira_estimate_secs: null, jira_status: null, description: null, epics: null,
    };
    const r = mapTaskRow(raw);
    expect(r.estimatedMinutes).toBeNull();
    expect(r.description).toBeNull();
    expect(r.taskTitle).toBe('');
  });

  it('falls back to jira_estimate_secs (÷60) when no manual estimate; manual wins', () => {
    const base = {
      id: 9, sync_id: 's9', epic_id: 1, number: 'X-9', title: 'T', status: 'open',
      jira_status: null, description: null, epics: null,
    };
    // Jira-only: 7200s → 120min.
    expect(mapTaskRow({ ...base, estimated_minutes: null, jira_estimate_secs: 7200 }).estimatedMinutes).toBe(120);
    // Manual wins over a (different) Jira estimate.
    expect(mapTaskRow({ ...base, estimated_minutes: 45, jira_estimate_secs: 7200 }).estimatedMinutes).toBe(45);
    // Neither → null.
    expect(mapTaskRow({ ...base, estimated_minutes: null, jira_estimate_secs: null }).estimatedMinutes).toBeNull();
  });
});

describe('loadCache — slice 3a shape guard', () => {
  it('rejects a cache without an epics array (forces refetch)', async () => {
    const store = new Map<string, string>();
    const legacy = { worklogs: [], contracts: [], daysOff: [], projects: [], tasks: [], fetchedAt: '2026-06-01T00:00:00Z' };
    store.set('watchtower.ipad.billing.cache', JSON.stringify(legacy));
    const adapter = { get: async (k: string) => store.get(k) ?? null, set: async () => {} };
    expect(await loadCache(adapter)).toBeNull();
  });
});

import { mapContractRow } from '@watchtower/data-supabase';
import type { RawContractRow } from '@watchtower/data-supabase';

describe('mapContractRow', () => {
  it('maps a raw contract row incl. syncId, nullable end_date/md_limit', () => {
    const raw: RawContractRow = {
      sync_id: 'c1', project_id: 3, effective_from: '2026-01-01', end_date: null,
      rate_type: 'hourly', rate_amount: 100, hours_per_day: 8, md_limit: null,
    };
    expect(mapContractRow(raw)).toEqual({
      syncId: 'c1', projectId: 3, effectiveFrom: '2026-01-01', endDate: null,
      rateType: 'hourly', rateAmount: 100, hoursPerDay: 8, mdLimit: null,
      contractGroupId: null,
    });
  });
});
