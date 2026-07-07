import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { ProjectsRepo } from '../../orchestrator/db/repositories/projects.js';
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
