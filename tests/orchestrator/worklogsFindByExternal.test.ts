import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { ProjectsRepo } from '../../orchestrator/db/repositories/projects.js';
import { EpicsRepo } from '../../orchestrator/db/repositories/epics.js';
import { TasksRepo } from '../../orchestrator/db/repositories/tasks.js';
import { WorklogsRepo } from '../../orchestrator/db/repositories/worklogs.js';
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function seedTask(sqlite: SqliteLike): number {
  const p = new ProjectsRepo(sqlite).create({ name: 'P' });
  const e = new EpicsRepo(sqlite).create({ projectId: p.id, name: 'E' });
  return new TasksRepo(sqlite).create({ epicId: e.id, number: 'T-1', title: 'Task' }).id;
}

describe('WorklogsRepo.findByExternalId', () => {
  let sqlite: SqliteLike;
  beforeEach(() => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    sqlite = db as unknown as SqliteLike;
    runMigrations(sqlite);
  });

  it('finds a row by (source, external_id) and returns null otherwise', () => {
    const taskId = seedTask(sqlite);
    const repo = new WorklogsRepo(sqlite);
    repo.create({
      taskId, workDate: '2026-07-03', minutes: 42,
      source: 'watchtower-auto', externalId: 'auto:inst-1:2026-07-03',
    });
    const found = repo.findByExternalId('watchtower-auto', 'auto:inst-1:2026-07-03');
    expect(found?.minutes).toBe(42);
    expect(repo.findByExternalId('watchtower-auto', 'auto:inst-1:2026-07-04')).toBeNull();
    expect(repo.findByExternalId('manual', 'auto:inst-1:2026-07-03')).toBeNull();
  });
});
