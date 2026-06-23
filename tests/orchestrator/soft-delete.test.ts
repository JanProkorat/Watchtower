import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { ProjectsRepo } from '../../orchestrator/db/repositories/projects.js';
import { EpicsRepo } from '../../orchestrator/db/repositories/epics.js';
import { TasksRepo } from '../../orchestrator/db/repositories/tasks.js';
import { WorklogsRepo } from '../../orchestrator/db/repositories/worklogs.js';
import { ProjectRatesRepo } from '../../orchestrator/db/repositories/projectRates.js';
import { DaysOffRepo } from '../../orchestrator/db/repositories/daysOff.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function freshDb(): SqliteLike {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db as unknown as SqliteLike);
  return db as unknown as SqliteLike;
}

describe('sync columns on write', () => {
  let db: SqliteLike;
  beforeEach(() => { db = freshDb(); });

  it('create sets sync_id + updated_at', () => {
    const repo = new ProjectsRepo(db);
    const p = repo.create({ name: 'P' });
    const raw = db.prepare(`SELECT sync_id, updated_at, deleted_at FROM projects WHERE id = ?`).get(p.id) as any;
    expect(raw.sync_id).toBeTruthy();
    expect(raw.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(raw.deleted_at).toBeNull();
  });

  it('update bumps updated_at', async () => {
    const repo = new ProjectsRepo(db);
    const p = repo.create({ name: 'P' });
    const before = (db.prepare(`SELECT updated_at FROM projects WHERE id=?`).get(p.id) as any).updated_at;
    await new Promise((r) => setTimeout(r, 5));
    repo.update(p.id, { name: 'P2' });
    const after = (db.prepare(`SELECT updated_at FROM projects WHERE id=?`).get(p.id) as any).updated_at;
    expect(after >= before).toBe(true);
    expect(after).not.toBe(before);
  });
});

describe('soft-delete invisibility + cascade', () => {
  let db: SqliteLike;
  let projects: ProjectsRepo, epics: EpicsRepo, tasks: TasksRepo, worklogs: WorklogsRepo, rates: ProjectRatesRepo;
  beforeEach(() => {
    db = freshDb();
    projects = new ProjectsRepo(db); epics = new EpicsRepo(db);
    tasks = new TasksRepo(db); worklogs = new WorklogsRepo(db); rates = new ProjectRatesRepo(db);
  });

  function tree() {
    const p = projects.create({ name: 'P' });
    const e = epics.create({ projectId: p.id, name: 'E' });
    const t = tasks.create({ epicId: e.id, number: 'N1', title: 'T' });
    const w = worklogs.create({ taskId: t.id, workDate: '2026-01-01', minutes: 60 });
    const c = rates.create({ projectId: p.id, effectiveFrom: '2026-01-01', rateType: 'hourly', rateAmount: 100, currency: 'CZK' });
    return { p, e, t, w, c };
  }

  it('worklog soft-delete hides it from list/get but keeps the row', () => {
    const { t, w } = tree();
    worklogs.delete(w.id);
    expect(worklogs.get(w.id)).toBeNull();
    expect(worklogs.list({ taskId: t.id })).toHaveLength(0);
    const raw = db.prepare(`SELECT deleted_at FROM worklogs WHERE id=?`).get(w.id) as any;
    expect(raw.deleted_at).toBeTruthy();
  });

  it('deleting a project cascades soft-delete to epics, tasks, worklogs, contracts', () => {
    const { p, e, t, w, c } = tree();
    projects.delete(p.id);
    expect(projects.get(p.id)).toBeNull();
    expect(epics.get(e.id)).toBeNull();
    expect(tasks.get(t.id)).toBeNull();
    expect(worklogs.get(w.id)).toBeNull();
    expect(rates.get(c.id)).toBeNull();
    // Rows still physically present, all tombstoned.
    for (const [tbl, id] of [['epics', e.id], ['tasks', t.id], ['worklogs', w.id], ['contracts', c.id]] as const) {
      const raw = db.prepare(`SELECT deleted_at FROM ${tbl} WHERE id=?`).get(id) as any;
      expect(raw.deleted_at, `${tbl} tombstoned`).toBeTruthy();
    }
  });

  it('deleting an epic cascades to its tasks and worklogs only', () => {
    const { e, t, w } = tree();
    epics.delete(e.id);
    expect(tasks.get(t.id)).toBeNull();
    expect(worklogs.get(w.id)).toBeNull();
  });

  it('days_off soft-delete hides the date', () => {
    const repo = new DaysOffRepo(db);
    repo.upsert({ date: '2026-02-02', kind: 'vacation' });
    repo.delete('2026-02-02');
    expect(repo.get('2026-02-02')).toBeNull();
    expect(repo.listAll()).toHaveLength(0);
  });

  it('re-upserting a soft-deleted day_off revives it', () => {
    const repo = new DaysOffRepo(db);
    repo.upsert({ date: '2026-02-02', kind: 'vacation' });
    repo.delete('2026-02-02');
    repo.upsert({ date: '2026-02-02', kind: 'sick' });
    expect(repo.get('2026-02-02')?.kind).toBe('sick');
  });
});
