import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../../orchestrator/db/migrations.js';
import { createPgStore, type PgStore } from '../../../orchestrator/db/pg/pool.js';
import { runPgMigrations } from '../../../orchestrator/db/pg/migrate.js';
import { pushAll, pushTable } from '../../../orchestrator/sync/push.js';
import { getCursor, setCursor } from '../../../orchestrator/sync/cursor.js';
import { SYNCED_TABLES } from '../../../orchestrator/sync/schema.js';
import { ProjectsRepo } from '../../../orchestrator/db/repositories/projects.js';
import { EpicsRepo } from '../../../orchestrator/db/repositories/epics.js';
import { TasksRepo } from '../../../orchestrator/db/repositories/tasks.js';
import { WorklogsRepo } from '../../../orchestrator/db/repositories/worklogs.js';
import { ProjectRatesRepo } from '../../../orchestrator/db/repositories/projectRates.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
const PG_URL = process.env.WATCHTOWER_PG_URL ?? 'postgresql://watchtower:watchtower_dev_password@localhost:5432/watchtower';

let store: PgStore | null = null;
let reachable = false;
beforeAll(async () => {
  store = createPgStore(PG_URL);
  if (!store) return;
  try { await store.healthCheck(); reachable = true; } catch { console.warn('[push.test] pg unreachable — skipping'); }
});
afterAll(async () => { if (store) await store.end(); });

function freshSqlite(): SqliteLike {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db as unknown as SqliteLike);
  return db as unknown as SqliteLike;
}

describe('cursor', () => {
  it('defaults to epoch and round-trips', () => {
    const db = freshSqlite();
    expect(getCursor(db, 'push', 'projects')).toBe('1970-01-01T00:00:00.000Z');
    setCursor(db, 'push', 'projects', '2026-01-01T00:00:00.000Z');
    expect(getCursor(db, 'push', 'projects')).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('pushAll', () => {
  beforeEach(async () => {
    if (reachable && store) { await store.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`); await runPgMigrations(store); }
  });

  it('pushes new local rows to Postgres with resolved FKs', async () => {
    if (!reachable || !store) return;
    const db = freshSqlite();
    const p = new ProjectsRepo(db).create({ name: 'Push P' });
    new EpicsRepo(db).create({ projectId: p.id, name: 'Push E' });

    const counts = await pushAll(db, store);
    expect(counts.projects).toBe(1);
    expect(counts.epics).toBe(1);

    const { rows } = await store.query(`SELECT e.name FROM epics e JOIN projects p ON p.id=e.project_id WHERE p.name='Push P'`);
    expect(rows).toHaveLength(1);
  });

  it('is incremental: a second push with no local changes pushes nothing', async () => {
    if (!reachable || !store) return;
    const db = freshSqlite();
    new ProjectsRepo(db).create({ name: 'Once' });
    await pushAll(db, store);
    const counts2 = await pushAll(db, store);
    expect(counts2.projects).toBe(0);
  });

  it('LWW: an older local update does not clobber a newer Postgres row', async () => {
    if (!reachable || !store) return;
    const db = freshSqlite();
    const repo = new ProjectsRepo(db);
    const p = repo.create({ name: 'LWW' });
    await pushAll(db, store);
    // Simulate a newer remote edit.
    await store.query(`UPDATE projects SET name='RemoteNewer', updated_at = now() + interval '1 hour' WHERE name='LWW'`);
    // Local edit with an OLDER timestamp (force the cursor + updated_at back).
    const syncId = (db.prepare(`SELECT sync_id FROM projects WHERE id=?`).get(p.id) as any).sync_id;
    db.prepare(`UPDATE projects SET name='LocalOlder', updated_at='2000-01-01T00:00:00.000Z' WHERE id=?`).run(p.id);
    setCursor(db, 'push', 'projects', '1999-01-01T00:00:00.000Z');
    await pushTable(db, store, SYNCED_TABLES.find((t) => t.name === 'projects')!);
    const { rows } = await store.query<{ name: string }>(`SELECT name FROM projects WHERE sync_id=$1`, [syncId]);
    expect(rows[0]?.name).toBe('RemoteNewer'); // remote (newer) survived
  });

  it('derived billing columns land in Postgres after push', async () => {
    if (!reachable || !store) return;
    const db = freshSqlite();

    // Seed: project → contract → epic → task → worklog
    const project = new ProjectsRepo(db).create({ name: 'Billing Project' });
    new ProjectRatesRepo(db).create({
      projectId: project.id,
      effectiveFrom: '2026-01-01',
      rateType: 'hourly',
      rateAmount: 120,
      hoursPerDay: 8,
    });
    const epic = new EpicsRepo(db).create({ projectId: project.id, name: 'Billing Epic' });
    const task = new TasksRepo(db).create({ epicId: epic.id, number: 'B-1', title: 'Billing Task' });
    const worklog = new WorklogsRepo(db).create({
      taskId: task.id,
      workDate: '2026-06-01',
      minutes: 60, // 1 hour @ 120 CZK = 120 CZK
    });

    const wlSyncId = (db.prepare('SELECT sync_id FROM worklogs WHERE id = ?').get(worklog.id) as any).sync_id;

    await pushAll(db, store);

    const { rows } = await store.query<{
      effective_minutes: number;
      resolved_rate: string;
      rate_currency: string;
      earned_amount: string;
    }>(`SELECT effective_minutes, resolved_rate, rate_currency, earned_amount
          FROM worklogs WHERE sync_id = $1`, [wlSyncId]);

    expect(rows).toHaveLength(1);
    expect(rows[0].effective_minutes).toBe(60);
    expect(Number(rows[0].resolved_rate)).toBe(120);
    expect(rows[0].rate_currency).toBe('CZK');
    expect(Number(rows[0].earned_amount)).toBeCloseTo(120, 5);
  });

  it('derived billing columns are null for a worklog with no matching contract', async () => {
    if (!reachable || !store) return;
    const db = freshSqlite();

    // Seed: project (no contract) → epic → task → worklog
    const project = new ProjectsRepo(db).create({ name: 'No Contract Project' });
    const epic = new EpicsRepo(db).create({ projectId: project.id, name: 'NC Epic' });
    const task = new TasksRepo(db).create({ epicId: epic.id, number: 'NC-1', title: 'NC Task' });
    const worklog = new WorklogsRepo(db).create({
      taskId: task.id,
      workDate: '2026-06-01',
      minutes: 60,
    });

    const wlSyncId = (db.prepare('SELECT sync_id FROM worklogs WHERE id = ?').get(worklog.id) as any).sync_id;

    await pushAll(db, store);

    const { rows } = await store.query<{
      effective_minutes: number;
      earned_amount: string | null;
    }>(`SELECT effective_minutes, earned_amount FROM worklogs WHERE sync_id = $1`, [wlSyncId]);

    expect(rows).toHaveLength(1);
    expect(rows[0].effective_minutes).toBe(60);
    expect(rows[0].earned_amount).toBeNull();
  });
});
