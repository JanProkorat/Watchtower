import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../../orchestrator/db/migrations.js';
import { createPgStore, type PgStore } from '../../../orchestrator/db/pg/pool.js';
import { runPgMigrations } from '../../../orchestrator/db/pg/migrate.js';
import { pushAll } from '../../../orchestrator/sync/push.js';
import { pullAll } from '../../../orchestrator/sync/pull.js';
import { ProjectsRepo } from '../../../orchestrator/db/repositories/projects.js';
import { EpicsRepo } from '../../../orchestrator/db/repositories/epics.js';
import { TasksRepo } from '../../../orchestrator/db/repositories/tasks.js';
import { WorklogsRepo } from '../../../orchestrator/db/repositories/worklogs.js';
import { ProjectRatesRepo } from '../../../orchestrator/db/repositories/projectRates.js';
import { DaysOffRepo } from '../../../orchestrator/db/repositories/daysOff.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
const PG_URL = process.env.WATCHTOWER_PG_URL ?? 'postgresql://watchtower:watchtower_dev_password@localhost:5432/watchtower';

// Safety guard: never DROP SCHEMA on a non-localhost URL (prevents accidental
// wipe of staging/prod databases if WATCHTOWER_PG_URL is mis-configured).
const urlIsLocalhost = PG_URL.includes('localhost') || PG_URL.includes('127.0.0.1');
if (!urlIsLocalhost) throw new Error(`[pull.test] refusing DROP SCHEMA on non-localhost PG_URL: ${PG_URL}`);

let store: PgStore | null = null;
let reachable = false;
beforeAll(async () => {
  store = createPgStore(PG_URL);
  if (!store) return;
  try { await store.healthCheck(); reachable = true; } catch { console.warn('[pull.test] pg unreachable — skipping'); }
});
afterAll(async () => { if (store) await store.end(); });

function freshSqlite(): SqliteLike {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db as unknown as SqliteLike);
  return db as unknown as SqliteLike;
}

describe('pullAll', () => {
  beforeEach(async () => {
    if (reachable && store) { await store.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`); await runPgMigrations(store); }
  });

  it('pulls a Postgres-only row into SQLite', async () => {
    if (!reachable || !store) return;
    await store.query(`INSERT INTO projects (sync_id, name, updated_at) VALUES ('remote-1','Remote P', now())`);
    const db = freshSqlite();
    const res = await pullAll(db, store);
    expect(res.projects.pulled).toBe(1);
    const row = db.prepare(`SELECT name, sync_id FROM projects WHERE sync_id='remote-1'`).get() as any;
    expect(row.name).toBe('Remote P');
  });

  it('applies a remote tombstone as a local soft-delete', async () => {
    if (!reachable || !store) return;
    const db = freshSqlite();
    const p = new ProjectsRepo(db).create({ name: 'Doomed' });
    await pushAll(db, store);
    const syncId = (db.prepare(`SELECT sync_id FROM projects WHERE id=?`).get(p.id) as any).sync_id;
    await store.query(`UPDATE projects SET deleted_at = now(), updated_at = now() + interval '1 minute' WHERE sync_id=$1`, [syncId]);
    await pullAll(db, store);
    expect(new ProjectsRepo(db).get(p.id)).toBeNull();
    const raw = db.prepare(`SELECT deleted_at FROM projects WHERE id=?`).get(p.id) as any;
    expect(raw.deleted_at).toBeTruthy();
  });

  it('logs a conflict when both sides changed and remote wins', async () => {
    if (!reachable || !store) return;
    const db = freshSqlite();
    const p = new ProjectsRepo(db).create({ name: 'Base' });
    await pushAll(db, store);
    const syncId = (db.prepare(`SELECT sync_id FROM projects WHERE id=?`).get(p.id) as any).sync_id;
    // Local edit (older) since last pull, remote edit (newer).
    db.prepare(`UPDATE projects SET name='LocalEdit', updated_at='2020-01-01T00:00:00.000Z' WHERE id=?`).run(p.id);
    await store.query(`UPDATE projects SET name='RemoteEdit', updated_at = now() + interval '1 hour' WHERE sync_id=$1`, [syncId]);
    const res = await pullAll(db, store);
    expect(res.projects.conflicts).toBeGreaterThanOrEqual(1);
    expect((db.prepare(`SELECT name FROM projects WHERE id=?`).get(p.id) as any).name).toBe('RemoteEdit');
    const { rows } = await store.query<{ c: string }>(`SELECT COUNT(*)::text c FROM sync_conflicts WHERE sync_id=$1`, [syncId]);
    expect(Number(rows[0]!.c)).toBeGreaterThanOrEqual(1);
  });

  it('no spurious conflict when local and remote are aligned (post-ETL/post-push state)', async () => {
    // Regression test for Fix 1: when localUpdated == remoteUpdated (i.e. the
    // row was pushed and both stores now carry identical updated_at), a fresh
    // pullAll with a EPOCH cursor must NOT log a local_won conflict.
    if (!reachable || !store) return;
    const db = freshSqlite();
    // Create a project locally and push it to PG — both stores now have the
    // same updated_at for this row.
    const p = new ProjectsRepo(db).create({ name: 'Aligned' });
    await pushAll(db, store);
    const syncId = (db.prepare(`SELECT sync_id FROM projects WHERE id=?`).get(p.id) as any).sync_id;
    // Use a second fresh SQLite with an EPOCH pull cursor (simulates first
    // pullAll after ETL). The row exists in PG; the SQLite already has the same
    // row with identical updated_at because it was just pushed.
    // Simulate "fresh pull cursor" by running pullAll on the same db — the
    // existing pull cursor was never set (EPOCH), so localUpdated == remoteUpdated.
    const syncId2 = syncId; // same db, cursor is at EPOCH
    const res = await pullAll(db, store);
    expect(res.projects.conflicts).toBe(0);
    const { rows } = await store.query<{ c: string }>(
      `SELECT COUNT(*)::text c FROM sync_conflicts WHERE sync_id=$1`,
      [syncId2],
    );
    expect(Number(rows[0]!.c)).toBe(0);
  });

  it('pulls a worklog carrying Postgres-only derived billing columns without writing them to SQLite', async () => {
    // Regression test: the worklogs table has Postgres-only derived columns
    // (effective_minutes, resolved_rate, rate_currency, earned_amount) flagged
    // `derived: true` — they exist in Postgres but not in SQLite. Before the
    // pull.ts fix, pullAll SELECTed them from PG and tried to INSERT them into
    // SQLite, throwing "table worklogs has no column named effective_minutes".
    // The pull path must skip `derived` columns symmetrically with push.ts.
    if (!reachable || !store) return;
    const db = freshSqlite();
    const project = new ProjectsRepo(db).create({ name: 'Billed P' });
    new ProjectRatesRepo(db).create({
      projectId: project.id,
      effectiveFrom: '2026-01-01',
      rateType: 'hourly',
      rateAmount: 100,
      currency: 'CZK',
      hoursPerDay: 8,
    });
    const epic = new EpicsRepo(db).create({ projectId: project.id, name: 'Billed E' });
    const task = new TasksRepo(db).create({ epicId: epic.id, number: 'B-1', title: 'Billed T' });
    const worklog = new WorklogsRepo(db).create({ taskId: task.id, workDate: '2026-06-01', minutes: 120 });
    const wlSyncId = (db.prepare('SELECT sync_id FROM worklogs WHERE id=?').get(worklog.id) as any).sync_id;

    // Push: PG now holds the worklog row with its derived billing columns populated.
    await pushAll(db, store);

    // Pull into a SECOND fresh SQLite (EPOCH cursor) — PULL_ORDER lands the
    // parents (project→epic→task) before worklogs, so a single pullAll
    // round-trips the whole hierarchy. This MUST NOT throw on the derived columns.
    const db2 = freshSqlite();
    const res = await pullAll(db2, store);
    expect(res.worklogs.pulled).toBeGreaterThanOrEqual(1);
    const pulled = db2.prepare('SELECT minutes, work_date FROM worklogs WHERE sync_id=?').get(wlSyncId) as any;
    // The point of this test is that the pull completes (no "no such column"
    // throw from the Postgres-only derived columns) and the row round-trips.
    // Assert on `minutes` (a non-date field): work_date is deliberately not
    // asserted exactly here because `toSqliteValue`'s date coercion has a
    // separate, pre-existing UTC-vs-local off-by-one-day shift on pull
    // (tracked as a follow-up), unrelated to the derived-columns fix.
    expect(pulled.minutes).toBe(120);
    // Exact round-trip: PG DATE must survive the pull without UTC↔local shift.
    expect(pulled.work_date).toBe('2026-06-01');
  });

  it('date columns round-trip exactly through push→pull (contracts effective_from, days_off date)', async () => {
    // Regression: node-postgres parses DATE OID 1082 as a JS Date at local
    // midnight. toISOString() then converts to UTC, shifting the date back by
    // 1 day in Europe/Prague (UTC+1/+2). The fix registers a type parser that
    // returns the raw 'YYYY-MM-DD' string, so toSqliteValue never sees a Date
    // for date-kind columns.
    if (!reachable || !store) return;
    const db = freshSqlite();

    // contracts: push a contract with a specific effective_from and end_date.
    const project = new ProjectsRepo(db).create({ name: 'DateTest P' });
    new ProjectRatesRepo(db).create({
      projectId: project.id,
      effectiveFrom: '2026-03-15',
      rateType: 'hourly',
      rateAmount: 200,
      currency: 'CZK',
      hoursPerDay: 8,
      endDate: '2026-12-31',
    });
    const contractSyncId = (db.prepare(
      `SELECT sync_id FROM contracts WHERE project_id=?`
    ).get(project.id) as any).sync_id;

    // days_off: push a day-off row.
    const dayOff = new DaysOffRepo(db).upsert({ date: '2026-07-04', kind: 'vacation' });
    const dayOffSyncId = (db.prepare(
      `SELECT sync_id FROM days_off WHERE date=?`
    ).get(dayOff.date) as any).sync_id;

    await pushAll(db, store);

    // Pull into a fresh SQLite and verify exact date strings.
    const db2 = freshSqlite();
    await pullAll(db2, store);

    const contract = db2.prepare(
      `SELECT effective_from, end_date FROM contracts WHERE sync_id=?`
    ).get(contractSyncId) as any;
    expect(contract.effective_from).toBe('2026-03-15');
    expect(contract.end_date).toBe('2026-12-31');

    const daysOffRow = db2.prepare(
      `SELECT date FROM days_off WHERE sync_id=?`
    ).get(dayOffSyncId) as any;
    expect(daysOffRow.date).toBe('2026-07-04');
  });
});
