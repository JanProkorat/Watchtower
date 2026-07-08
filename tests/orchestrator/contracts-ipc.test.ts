import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { ProjectsRepo } from '../../orchestrator/db/repositories/projects.js';
import { EpicsRepo } from '../../orchestrator/db/repositories/epics.js';
import { TasksRepo } from '../../orchestrator/db/repositories/tasks.js';
import { WorklogsRepo } from '../../orchestrator/db/repositories/worklogs.js';
import { SyncService } from '../../orchestrator/sync/service.js';
import { handleRequest, __setHandleForTests } from '../../orchestrator/index.js';
import type { BootstrapHandle } from '../../orchestrator/bootstrap.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function freshDb(): SqliteLike {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db as unknown as SqliteLike);
  return db as unknown as SqliteLike;
}

const STANDARD = {
  rateType: 'hourly' as const,
  rateAmount: 1600,
  hoursPerDay: 8,
};

describe('contracts:* IPC handlers — solo vs shared groups', () => {
  let db: SqliteLike;
  let projects: ProjectsRepo;
  let projectA: number;
  let projectB: number;
  let projectC: number;

  beforeEach(() => {
    db = freshDb();
    projects = new ProjectsRepo(db);
    projectA = projects.create({ name: 'Project A', kind: 'work' }).id;
    projectB = projects.create({ name: 'Project B', kind: 'work' }).id;
    projectC = projects.create({ name: 'Project C', kind: 'work' }).id;
    // Minimal fake handle: only `db` and `sync` are touched by the contracts
    // handlers under test (no real bootstrap/parentPort/ws wiring needed).
    __setHandleForTests({
      db,
      sync: new SyncService({ db, store: null }),
    } as unknown as BootstrapHandle);
  });

  afterEach(() => {
    __setHandleForTests(null);
  });

  it('create with a single projectId behaves exactly as a solo contract (no groupId)', async () => {
    const res = (await handleRequest({
      id: '1',
      kind: 'contracts:create',
      payload: { projectId: projectA, effectiveFrom: '2026-01-01', ...STANDARD },
    })) as { contract: { groupId: string | null; projectIds: number[]; projectId: number } };
    expect(res.contract.groupId).toBeNull();
    expect(res.contract.projectIds).toEqual([projectA]);
    expect(res.contract.projectId).toBe(projectA);
  });

  it('create with projectIds:[A,B] shares one groupId across both rows', async () => {
    const res = (await handleRequest({
      id: '2',
      kind: 'contracts:create',
      payload: {
        projectId: projectA,
        projectIds: [projectA, projectB],
        effectiveFrom: '2026-01-01',
        ...STANDARD,
      },
    })) as { contract: { groupId: string | null; projectIds: number[] } };
    expect(res.contract.groupId).not.toBeNull();
    expect(res.contract.projectIds.slice().sort()).toEqual([projectA, projectB].sort());

    // Both projects list the same shared contract (same groupId).
    const listA = (await handleRequest({
      id: '2a',
      kind: 'contracts:listForProject',
      payload: { projectId: projectA },
    })) as { contracts: Array<{ groupId: string | null }> };
    const listB = (await handleRequest({
      id: '2b',
      kind: 'contracts:listForProject',
      payload: { projectId: projectB },
    })) as { contracts: Array<{ groupId: string | null }> };
    expect(listA.contracts[0].groupId).toBe(res.contract.groupId);
    expect(listB.contracts[0].groupId).toBe(res.contract.groupId);
  });

  it('create that overlaps returns conflictingProjectId + conflictingProjectName', async () => {
    await handleRequest({
      id: '3a',
      kind: 'contracts:create',
      payload: { projectId: projectA, effectiveFrom: '2026-01-01', endDate: '2026-06-30', ...STANDARD },
    });
    const res = (await handleRequest({
      id: '3b',
      kind: 'contracts:create',
      payload: { projectId: projectA, effectiveFrom: '2026-03-01', ...STANDARD },
    })) as { error: string; conflictingProjectId: number; conflictingProjectName: string };
    expect(res.error).toBe('overlap');
    expect(res.conflictingProjectId).toBe(projectA);
    expect(res.conflictingProjectName).toBe('Project A');
  });

  it('update changes group membership (add + remove a member)', async () => {
    const created = (await handleRequest({
      id: '4a',
      kind: 'contracts:create',
      payload: {
        projectId: projectA,
        projectIds: [projectA, projectB],
        effectiveFrom: '2026-01-01',
        ...STANDARD,
      },
    })) as { contract: { id: number; groupId: string | null } };

    const updated = (await handleRequest({
      id: '4b',
      kind: 'contracts:update',
      payload: {
        id: created.contract.id,
        input: { projectIds: [projectA, projectC], rateAmount: 1700 },
      },
    })) as { contract: { groupId: string | null; projectIds: number[]; rateAmount: number } };

    expect(updated.contract.groupId).toBe(created.contract.groupId);
    expect(updated.contract.projectIds.slice().sort()).toEqual([projectA, projectC].sort());
    expect(updated.contract.rateAmount).toBe(1700);

    const listB = (await handleRequest({
      id: '4c',
      kind: 'contracts:listForProject',
      payload: { projectId: projectB },
    })) as { contracts: unknown[] };
    expect(listB.contracts).toHaveLength(0);
  });

  it('update that drops a member from the group rebills that project too', async () => {
    const created = (await handleRequest({
      id: '4d',
      kind: 'contracts:create',
      payload: {
        projectId: projectA,
        projectIds: [projectA, projectB],
        effectiveFrom: '2026-01-01',
        ...STANDARD,
      },
    })) as { contract: { id: number; groupId: string | null } };

    // A worklog on the soon-to-be-dropped project B, inside the contract
    // window, with a stale (pre-bumped) updated_at so we can detect whether
    // markWorklogsForRebill touched it.
    const epics = new EpicsRepo(db);
    const tasks = new TasksRepo(db);
    const worklogs = new WorklogsRepo(db);
    const epicB = epics.create({ projectId: projectB, name: 'Epic B' }).id;
    const taskB = tasks.create({ epicId: epicB, number: 'B-1', title: 'Task B' }).id;
    const worklogB = worklogs.create({ taskId: taskB, workDate: '2026-02-01', minutes: 60 }).id;
    db.prepare('UPDATE worklogs SET updated_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', worklogB);

    // Drop project B from the group (new membership is [A] only).
    await handleRequest({
      id: '4e',
      kind: 'contracts:update',
      payload: {
        id: created.contract.id,
        input: { projectIds: [projectA], rateAmount: 1700 },
      },
    });

    const row = db.prepare('SELECT updated_at FROM worklogs WHERE id = ?').get(worklogB) as {
      updated_at: string;
    };
    expect(row.updated_at).not.toBe('2000-01-01T00:00:00.000Z');
  });

  it('update promotes a SOLO contract into a shared group when projectIds adds a member', async () => {
    // Start from a plain solo contract (single projectId, no projectIds).
    const created = (await handleRequest({
      id: '6a',
      kind: 'contracts:create',
      payload: { projectId: projectA, effectiveFrom: '2026-01-01', ...STANDARD },
    })) as { contract: { id: number; groupId: string | null } };
    expect(created.contract.groupId).toBeNull();

    // Edit it and add project B via the shared-projects multi-select.
    const updated = (await handleRequest({
      id: '6b',
      kind: 'contracts:update',
      payload: {
        id: created.contract.id,
        input: { projectIds: [projectA, projectB], rateAmount: 1700 },
      },
    })) as { contract: { groupId: string | null; projectIds: number[]; rateAmount: number } };

    // A group must now exist, spanning both projects.
    expect(updated.contract.groupId).not.toBeNull();
    expect(updated.contract.projectIds.slice().sort()).toEqual([projectA, projectB].sort());
    expect(updated.contract.rateAmount).toBe(1700);

    // Both projects list the same shared contract.
    const listA = (await handleRequest({
      id: '6c',
      kind: 'contracts:listForProject',
      payload: { projectId: projectA },
    })) as { contracts: Array<{ groupId: string | null }> };
    const listB = (await handleRequest({
      id: '6d',
      kind: 'contracts:listForProject',
      payload: { projectId: projectB },
    })) as { contracts: Array<{ groupId: string | null }> };
    expect(listA.contracts[0].groupId).toBe(updated.contract.groupId);
    expect(listB.contracts[0].groupId).toBe(updated.contract.groupId);
  });

  it('solo→group promotion resurrects a tombstoned contract on the added project (same effective_from)', async () => {
    // Anchor solo contract on A.
    const created = (await handleRequest({
      id: '7a',
      kind: 'contracts:create',
      payload: { projectId: projectA, effectiveFrom: '2026-07-01', ...STANDARD },
    })) as { contract: { id: number } };

    // Project B already had a contract at the SAME effective_from that was
    // deleted — leaving a tombstone that the DB-level UNIQUE(project_id,
    // effective_from) still counts. A naive INSERT would collide here.
    const bSolo = (await handleRequest({
      id: '7b',
      kind: 'contracts:create',
      payload: { projectId: projectB, effectiveFrom: '2026-07-01', ...STANDARD },
    })) as { contract: { id: number } };
    await handleRequest({ id: '7c', kind: 'contracts:delete', payload: { id: bSolo.contract.id } });

    // Promote A's solo contract into a group that includes B — must resurrect
    // B's tombstone rather than throw a UNIQUE error.
    const updated = (await handleRequest({
      id: '7d',
      kind: 'contracts:update',
      payload: {
        id: created.contract.id,
        input: { projectIds: [projectA, projectB] },
      },
    })) as { contract: { groupId: string | null; projectIds: number[] }; error?: string };

    expect(updated.error).toBeUndefined();
    expect(updated.contract.groupId).not.toBeNull();
    expect(updated.contract.projectIds.slice().sort()).toEqual([projectA, projectB].sort());

    const listB = (await handleRequest({
      id: '7e',
      kind: 'contracts:listForProject',
      payload: { projectId: projectB },
    })) as { contracts: Array<{ groupId: string | null }> };
    expect(listB.contracts).toHaveLength(1);
    expect(listB.contracts[0].groupId).toBe(updated.contract.groupId);
  });

  it('delete removes the whole group', async () => {
    const created = (await handleRequest({
      id: '5a',
      kind: 'contracts:create',
      payload: {
        projectId: projectA,
        projectIds: [projectA, projectB],
        effectiveFrom: '2026-01-01',
        ...STANDARD,
      },
    })) as { contract: { id: number } };

    await handleRequest({ id: '5b', kind: 'contracts:delete', payload: { id: created.contract.id } });

    const listA = (await handleRequest({
      id: '5c',
      kind: 'contracts:listForProject',
      payload: { projectId: projectA },
    })) as { contracts: unknown[] };
    const listB = (await handleRequest({
      id: '5d',
      kind: 'contracts:listForProject',
      payload: { projectId: projectB },
    })) as { contracts: unknown[] };
    expect(listA.contracts).toHaveLength(0);
    expect(listB.contracts).toHaveLength(0);
  });
});
