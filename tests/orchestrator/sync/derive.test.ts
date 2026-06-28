import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../../orchestrator/db/migrations.js';
import { createWorklogDeriver } from '../../../orchestrator/sync/derive.js';
import { ProjectsRepo } from '../../../orchestrator/db/repositories/projects.js';
import { EpicsRepo } from '../../../orchestrator/db/repositories/epics.js';
import { TasksRepo } from '../../../orchestrator/db/repositories/tasks.js';
import { WorklogsRepo } from '../../../orchestrator/db/repositories/worklogs.js';
import { ProjectRatesRepo } from '../../../orchestrator/db/repositories/projectRates.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function freshSqlite(): SqliteLike {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-derive-')), 'data.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db as unknown as SqliteLike);
  return db as unknown as SqliteLike;
}

describe('createWorklogDeriver', () => {
  it('computes billing fields for a worklog backed by an hourly contract', () => {
    const db = freshSqlite();

    // Seed: project → epic → task → worklog + contract
    const project = new ProjectsRepo(db).create({ name: 'Proj A' });
    const epic = new EpicsRepo(db).create({ projectId: project.id, name: 'Epic A' });
    const task = new TasksRepo(db).create({ epicId: epic.id, number: 'T-1', title: 'Task A' });
    new ProjectRatesRepo(db).create({
      projectId: project.id,
      effectiveFrom: '2026-01-01',
      rateType: 'hourly',
      rateAmount: 100,
      hoursPerDay: 8,
    });
    const worklog = new WorklogsRepo(db).create({
      taskId: task.id,
      workDate: '2026-06-01',
      minutes: 120,
    });

    // Look up the task's sync_id to feed as the raw row field
    const taskRow = db.prepare('SELECT sync_id FROM tasks WHERE id = ?').get(task.id) as { sync_id: string };
    const wlRow = db.prepare('SELECT sync_id, minutes, reported_minutes, work_date FROM worklogs WHERE id = ?').get(worklog.id) as Record<string, unknown>;

    const rawRow = {
      sync_id: wlRow.sync_id,
      task_sync_id: taskRow.sync_id,
      work_date: wlRow.work_date,
      minutes: wlRow.minutes,
      reported_minutes: wlRow.reported_minutes,
    };

    const deriver = createWorklogDeriver(db);
    const result = deriver(rawRow);

    // 120 minutes @ 100 CZK/hour = 200 CZK
    expect(result.effective_minutes).toBe(120);
    expect(result.resolved_rate).toBe(100);
    expect(result.earned_amount).toBeCloseTo(200, 5);
  });

  it('computes with reported_minutes when set', () => {
    const db = freshSqlite();

    const project = new ProjectsRepo(db).create({ name: 'Proj B' });
    const epic = new EpicsRepo(db).create({ projectId: project.id, name: 'Epic B' });
    const task = new TasksRepo(db).create({ epicId: epic.id, number: 'T-2', title: 'Task B' });
    new ProjectRatesRepo(db).create({
      projectId: project.id,
      effectiveFrom: '2026-01-01',
      rateType: 'hourly',
      rateAmount: 60,
      hoursPerDay: 8,
    });
    const worklog = new WorklogsRepo(db).create({
      taskId: task.id,
      workDate: '2026-06-01',
      minutes: 90,
      reportedMinutes: 60,
    });

    const taskRow = db.prepare('SELECT sync_id FROM tasks WHERE id = ?').get(task.id) as { sync_id: string };
    const wlRow = db.prepare('SELECT sync_id, minutes, reported_minutes, work_date FROM worklogs WHERE id = ?').get(worklog.id) as Record<string, unknown>;

    const rawRow = {
      sync_id: wlRow.sync_id,
      task_sync_id: taskRow.sync_id,
      work_date: wlRow.work_date,
      minutes: wlRow.minutes,
      reported_minutes: wlRow.reported_minutes,
    };

    const deriver = createWorklogDeriver(db);
    const result = deriver(rawRow);

    // reported_minutes=60 overrides minutes=90; 60 min @ 60 EUR/h = 60 EUR
    expect(result.effective_minutes).toBe(60);
    expect(result.earned_amount).toBeCloseTo(60, 5);
  });

  it('returns null billing fields when worklog has no task_sync_id (no contract)', () => {
    const db = freshSqlite();

    const deriver = createWorklogDeriver(db);
    const result = deriver({
      sync_id: 'abc',
      task_sync_id: null,
      work_date: '2026-06-01',
      minutes: 60,
      reported_minutes: null,
    });

    expect(result.effective_minutes).toBe(60);
    expect(result.resolved_rate).toBeNull();
    expect(result.earned_amount).toBeNull();
  });

  it('returns null billing fields when the task resolves to a project with no contract covering the work_date', () => {
    const db = freshSqlite();

    const project = new ProjectsRepo(db).create({ name: 'Proj NoContract' });
    const epic = new EpicsRepo(db).create({ projectId: project.id, name: 'Epic NC' });
    const task = new TasksRepo(db).create({ epicId: epic.id, number: 'T-3', title: 'Task NC' });
    // Contract starts 2027 — doesn't cover 2026 work date
    new ProjectRatesRepo(db).create({
      projectId: project.id,
      effectiveFrom: '2027-01-01',
      rateType: 'hourly',
      rateAmount: 50,
    });

    const taskRow = db.prepare('SELECT sync_id FROM tasks WHERE id = ?').get(task.id) as { sync_id: string };

    const deriver = createWorklogDeriver(db);
    const result = deriver({
      sync_id: 'xyz',
      task_sync_id: taskRow.sync_id,
      work_date: '2026-06-01',
      minutes: 60,
      reported_minutes: null,
    });

    expect(result.effective_minutes).toBe(60);
    expect(result.earned_amount).toBeNull();
  });

  it('caches project and contract lookups across multiple rows (same instance)', () => {
    const db = freshSqlite();

    const project = new ProjectsRepo(db).create({ name: 'Proj Cache' });
    const epic = new EpicsRepo(db).create({ projectId: project.id, name: 'Epic Cache' });
    const task = new TasksRepo(db).create({ epicId: epic.id, number: 'T-4', title: 'Task Cache' });
    new ProjectRatesRepo(db).create({
      projectId: project.id,
      effectiveFrom: '2026-01-01',
      rateType: 'daily',
      rateAmount: 800,
      hoursPerDay: 8,
    });

    const taskRow = db.prepare('SELECT sync_id FROM tasks WHERE id = ?').get(task.id) as { sync_id: string };
    const deriver = createWorklogDeriver(db);

    const rawRow = {
      sync_id: 'r1',
      task_sync_id: taskRow.sync_id,
      work_date: '2026-06-01',
      minutes: 480, // 8 hours = 1 day
      reported_minutes: null,
    };

    const r1 = deriver(rawRow);
    const r2 = deriver({ ...rawRow, sync_id: 'r2' });

    // Both should yield the same billing (480 min / 60 / 8 * 800 = 800 CZK)
    expect(r1.earned_amount).toBeCloseTo(800, 5);
    expect(r2.earned_amount).toBeCloseTo(800, 5);
  });
});
