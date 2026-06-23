import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../../orchestrator/db/migrations.js';
import { SyncService } from '../../../orchestrator/sync/service.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

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
    const svc = new SyncService({
      db: freshSqlite(), store: null, debounceMs: 20,
      onCycle: () => { cycles++; },
    });
    svc.start();
    svc.notifyLocalChange();
    svc.notifyLocalChange();
    svc.notifyLocalChange();
    await new Promise((r) => setTimeout(r, 60));
    svc.stop();
    expect(cycles).toBe(1);
  });
});
