import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../../orchestrator/db/migrations.js';
import { createPgStore, type PgStore } from '../../../orchestrator/db/pg/pool.js';
import { runPgMigrations } from '../../../orchestrator/db/pg/migrate.js';
import { pushAll } from '../../../orchestrator/sync/push.js';
import { ProjectsRepo } from '../../../orchestrator/db/repositories/projects.js';
import { EpicsRepo } from '../../../orchestrator/db/repositories/epics.js';
import { TasksRepo } from '../../../orchestrator/db/repositories/tasks.js';
import { WorklogsRepo } from '../../../orchestrator/db/repositories/worklogs.js';
import { SettingsRepo } from '../../../orchestrator/db/repositories/settings.js';
import { GRACE_MS, PURGE_MIN_INTERVAL_MS, purgeDue, purgeTombstones } from '../../../orchestrator/sync/purge.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
const PG_URL = process.env.WATCHTOWER_PG_URL ?? 'postgresql://watchtower:watchtower_dev_password@localhost:5432/watchtower';
const urlIsLocalhost = PG_URL.includes('localhost') || PG_URL.includes('127.0.0.1');
if (!urlIsLocalhost) throw new Error(`[purge.test] refusing DROP SCHEMA on non-localhost PG_URL: ${PG_URL}`);

function freshSqlite(): SqliteLike {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db as unknown as SqliteLike);
  return db as unknown as SqliteLike;
}

describe('purgeDue', () => {
  it('is due when never run before', () => {
    const db = freshSqlite();
    expect(purgeDue(db, Date.parse('2026-07-01T00:00:00.000Z'))).toBe(true);
  });

  it('is not due within the throttle interval, due after it', () => {
    const db = freshSqlite();
    const t0 = Date.parse('2026-07-01T00:00:00.000Z');
    new SettingsRepo(db).set('sync.purge.lastRunAt', new Date(t0).toISOString());
    expect(purgeDue(db, t0 + PURGE_MIN_INTERVAL_MS - 1)).toBe(false);
    expect(purgeDue(db, t0 + PURGE_MIN_INTERVAL_MS + 1)).toBe(true);
  });
});

describe('purgeTombstones', () => {
  let store: PgStore | null = null;
  let reachable = false;
  beforeAll(async () => {
    store = createPgStore(PG_URL);
    if (!store) return;
    try { await store.healthCheck(); reachable = true; } catch { console.warn('[purge.test] pg unreachable — skipping'); }
  });
  afterAll(async () => { if (store) await store.end(); });
  beforeEach(async () => {
    if (reachable && store) { await store.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`); await runPgMigrations(store); }
  });

  const NOW = Date.parse('2026-07-01T12:00:00.000Z');
  const OLD = new Date(NOW - 40 * 24 * 60 * 60 * 1000).toISOString(); // 40d ago > 30d grace
  const FRESH = new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString(); // 2d ago < grace

  // Tombstone a project's row in BOTH stores at a given deleted_at/updated_at.
  async function tombstoneBoth(db: SqliteLike, store: PgStore, id: number, syncId: string, ts: string) {
    db.prepare(`UPDATE projects SET deleted_at=?, updated_at=? WHERE id=?`).run(ts, ts, id);
    await store.query(`UPDATE projects SET deleted_at=$1, updated_at=$1 WHERE sync_id=$2`, [ts, syncId]);
  }

  it('hard-deletes tombstones older than the grace period from both stores', async () => {
    if (!reachable || !store) return;
    const db = freshSqlite();
    const p = new ProjectsRepo(db).create({ name: 'Old' });
    await pushAll(db, store);
    const syncId = (db.prepare(`SELECT sync_id FROM projects WHERE id=?`).get(p.id) as any).sync_id;
    await tombstoneBoth(db, store, p.id, syncId, OLD);

    const res = await purgeTombstones(db, store, NOW);

    expect(res.purged.projects).toBe(1);
    expect(db.prepare(`SELECT COUNT(*) c FROM projects WHERE sync_id=?`).get(syncId) as any).toMatchObject({ c: 0 });
    const { rows } = await store.query<{ c: string }>(`SELECT COUNT(*)::text c FROM projects WHERE sync_id=$1`, [syncId]);
    expect(Number(rows[0]!.c)).toBe(0);
  });

  it('leaves fresh tombstones and live rows untouched', async () => {
    if (!reachable || !store) return;
    const db = freshSqlite();
    const live = new ProjectsRepo(db).create({ name: 'Live' });
    const freshDel = new ProjectsRepo(db).create({ name: 'FreshDel' });
    await pushAll(db, store);
    const freshSyncId = (db.prepare(`SELECT sync_id FROM projects WHERE id=?`).get(freshDel.id) as any).sync_id;
    await tombstoneBoth(db, store, freshDel.id, freshSyncId, FRESH);

    const res = await purgeTombstones(db, store, NOW);

    expect(res.purged.projects).toBe(0);
    expect(db.prepare(`SELECT COUNT(*) c FROM projects WHERE deleted_at IS NULL`).get() as any).toMatchObject({ c: 1 }); // the live one
    expect(db.prepare(`SELECT COUNT(*) c FROM projects WHERE sync_id=?`).get(freshSyncId) as any).toMatchObject({ c: 1 }); // fresh tombstone kept
  });

  it('deletes child rows before parents without FK violation', async () => {
    if (!reachable || !store) return;
    const db = freshSqlite();
    // A project with an epic → task → worklog, then delete the project (cascade
    // tombstones the whole subtree), push the fresh tombstones to PG, then
    // backdate every tombstone in BOTH stores so they are older than GRACE_MS.
    const p = new ProjectsRepo(db).create({ name: 'Tree' });
    const e = new EpicsRepo(db).create({ projectId: p.id, name: 'E' });
    const t = new TasksRepo(db).create({ epicId: e.id, number: 'T-1', title: 'T' });
    new WorklogsRepo(db).create({ taskId: t.id, workDate: '2026-06-01', minutes: 60 });
    await pushAll(db, store);
    // Cascade-tombstone via the repo — fresh updated_at so pushAll can see them.
    new ProjectsRepo(db).delete(p.id);
    await pushAll(db, store); // propagate fresh tombstones to PG before backdating
    // Now backdate both stores so purge threshold sees them as expired.
    for (const tbl of ['projects', 'epics', 'tasks', 'worklogs']) {
      db.prepare(`UPDATE ${tbl} SET deleted_at=?, updated_at=? WHERE deleted_at IS NOT NULL`).run(OLD, OLD);
      await store.query(`UPDATE ${tbl} SET deleted_at=$1, updated_at=$1 WHERE deleted_at IS NOT NULL`, [OLD]);
    }

    const res = await purgeTombstones(db, store, NOW);

    expect(res.purged.worklogs).toBeGreaterThanOrEqual(1);
    expect(res.purged.projects).toBe(1);
    for (const tbl of ['projects', 'epics', 'tasks', 'worklogs']) {
      const { rows } = await store.query<{ c: string }>(`SELECT COUNT(*)::text c FROM ${tbl}`);
      expect(Number(rows[0]!.c)).toBe(0);
    }
  });

  it('is idempotent — a second purge deletes nothing', async () => {
    if (!reachable || !store) return;
    const db = freshSqlite();
    const p = new ProjectsRepo(db).create({ name: 'Once' });
    await pushAll(db, store);
    const syncId = (db.prepare(`SELECT sync_id FROM projects WHERE id=?`).get(p.id) as any).sync_id;
    await tombstoneBoth(db, store, p.id, syncId, OLD);
    await purgeTombstones(db, store, NOW);
    const res2 = await purgeTombstones(db, store, NOW + 1);
    expect(res2.purged.projects).toBe(0);
  });
});
