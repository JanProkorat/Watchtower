import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../../orchestrator/db/migrations.js';
import { createPgStore, type PgStore } from '../../../orchestrator/db/pg/pool.js';
import { runPgMigrations } from '../../../orchestrator/db/pg/migrate.js';
import { SyncService } from '../../../orchestrator/sync/service.js';
import { SettingsRepo } from '../../../orchestrator/db/repositories/settings.js';
import { ProjectsRepo } from '../../../orchestrator/db/repositories/projects.js';
import { pushAll } from '../../../orchestrator/sync/push.js';
import * as purgeModule from '../../../orchestrator/sync/purge.js';

vi.mock('../../../orchestrator/sync/purge.js', () => ({
  purgeDue: vi.fn(() => false),
  purgeTombstones: vi.fn(async () => ({ purged: {}, ranAt: '' })),
}));

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
const PG_URL = process.env.WATCHTOWER_PG_URL ?? 'postgresql://watchtower:watchtower_dev_password@localhost:5432/watchtower';

const urlIsLocalhost = PG_URL.includes('localhost') || PG_URL.includes('127.0.0.1');
if (!urlIsLocalhost) throw new Error(`[service.test] refusing DROP SCHEMA on non-localhost PG_URL: ${PG_URL}`);

let store: PgStore | null = null;
let reachable = false;
beforeAll(async () => {
  store = createPgStore(PG_URL);
  if (!store) return;
  try { await store.healthCheck(); reachable = true; } catch { console.warn('[service.test] pg unreachable — skipping live-PG tests'); }
});
afterAll(async () => { if (store) await store.end(); });

function freshSqlite(): SqliteLike {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db as unknown as SqliteLike);
  return db as unknown as SqliteLike;
}

describe('SyncService offline behaviour', () => {
  it('syncNow is a clean no-op when store is null', async () => {
    const svc = new SyncService({ db: freshSqlite(), store: null });
    const r = await svc.syncNow();
    expect(r.ok).toBe(true);
  });

  it('syncNow returns ok:false (does not throw) when the store query rejects', async () => {
    const failing = {
      query: async () => { throw new Error('ECONNREFUSED'); },
      healthCheck: async () => false,
      end: async () => {},
    };
    const svc = new SyncService({ db: freshSqlite(), store: failing as any });
    const r = await svc.syncNow();
    expect(r.ok).toBe(false);
    expect(r.error).toContain('ECONNREFUSED');
  });

  it('notifyLocalChange debounces into a single syncNow', async () => {
    let cycles = 0;
    const stub = {
      query: async () => ({ rows: [] }),
      healthCheck: async () => true,
      end: async () => {},
    };
    const svc = new SyncService({
      db: freshSqlite(), store: stub as any, debounceMs: 20,
      onCycle: () => { cycles++; },
    });
    svc.start();
    svc.notifyLocalChange();
    svc.notifyLocalChange();
    svc.notifyLocalChange();
    await new Promise((r) => setTimeout(r, 100));
    svc.stop();
    expect(cycles).toBe(1);
  });

  it('does not purge when the cycle fails to converge', async () => {
    const db = freshSqlite();
    const throwingStore = {
      query: async () => { throw new Error('pg down'); },
      healthCheck: async () => false,
      end: async () => {},
    } as unknown as PgStore;
    const svc = new SyncService({ db, store: throwingStore, now: () => Date.parse('2026-07-01T00:00:00.000Z') });
    const res = await svc.syncNow();
    expect(res.ok).toBe(false);
    expect(res.purge).toBeUndefined();
    // No purge ran → throttle key never written.
    expect(new SettingsRepo(db).getString('sync.purge.lastRunAt', '')).toBe('');
  });

  it('purge throw does not flip ok to false — failure-isolation contract', async () => {
    // Arrange: stub store converges trivially (no rows to push/pull).
    const stub = {
      query: async () => ({ rows: [] }),
      healthCheck: async () => true,
      end: async () => {},
    };
    // Make purgeDue return true so the purge block is entered, then make
    // purgeTombstones reject to exercise the inner catch.
    vi.mocked(purgeModule.purgeDue).mockReturnValueOnce(true);
    vi.mocked(purgeModule.purgeTombstones).mockRejectedValueOnce(new Error('purge exploded'));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const svc = new SyncService({ db: freshSqlite(), store: stub as any, now: () => Date.parse('2026-07-01T00:00:00.000Z') });
      const res = await svc.syncNow();

      // The cycle converged, so ok must remain true even though purge threw.
      expect(res.ok).toBe(true);
      // The error was swallowed — purge key must not appear in the result.
      expect(res.purge).toBeUndefined();
      // The throw was logged, not silently dropped.
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0][0]).toContain('[purge]');
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('SyncService live-PG purge', () => {
  beforeEach(async () => {
    if (reachable && store) { await store.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`); await runPgMigrations(store); }
  });

  it('purges old tombstones after a converged cycle', async () => {
    if (!reachable || !store) return;
    const db = freshSqlite();
    const p = new ProjectsRepo(db).create({ name: 'Doomed' });
    const NOW = Date.parse('2026-07-01T12:00:00.000Z');
    const OLD = new Date(NOW - 40 * 24 * 60 * 60 * 1000).toISOString();
    // The purge module is mocked globally; restore real implementations for this integration test.
    const { purgeDue: realPurgeDue, purgeTombstones: realPurgeTombstones } = await vi.importActual<typeof purgeModule>('../../../orchestrator/sync/purge.js');
    vi.mocked(purgeModule.purgeDue).mockImplementation(realPurgeDue);
    vi.mocked(purgeModule.purgeTombstones).mockImplementation(realPurgeTombstones);
    const svc = new SyncService({ db, store, now: () => NOW });
    await svc.syncNow(); // push it up
    const syncId = (db.prepare(`SELECT sync_id FROM projects WHERE id=?`).get(p.id) as any).sync_id;
    db.prepare(`UPDATE projects SET deleted_at=?, updated_at=? WHERE id=?`).run(OLD, OLD, p.id);
    await store.query(`UPDATE projects SET deleted_at=$1, updated_at=$1 WHERE sync_id=$2`, [OLD, syncId]);
    // Force the throttle open (first syncNow already recorded a run).
    new SettingsRepo(db).set('sync.purge.lastRunAt', '');
    const res = await svc.syncNow();
    expect(res.ok).toBe(true);
    expect(res.purge?.projects).toBe(1);
  });
});
