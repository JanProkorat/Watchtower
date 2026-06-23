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
});
