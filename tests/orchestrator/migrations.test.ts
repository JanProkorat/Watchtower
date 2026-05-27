import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';

// node:sqlite isn't on Vite's known-builtins list, so it strips the `node:` prefix
// and tries to resolve "sqlite" as a userland package. Bypass Vite's resolver
// via createRequire — Node's CJS resolver handles node:sqlite correctly.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

// Tests use node:sqlite (no native compilation needed) — runMigrations only
// touches the standard exec/prepare/get/run/all surface, so the two drivers
// are interchangeable for schema-level work.

describe('migrations', () => {
  let dbPath: string;
  let db: DatabaseSync;
  beforeEach(() => {
    dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
    db = new DatabaseSync(dbPath);
  });

  it('creates instances, hook_events, notifications, settings tables', () => {
    runMigrations(db as unknown as SqliteLike);
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain('instances');
    expect(names).toContain('hook_events');
    expect(names).toContain('notifications');
    expect(names).toContain('settings');
    expect(names).toContain('schema_version');
  });

  it('is idempotent when run twice', () => {
    runMigrations(db as unknown as SqliteLike);
    runMigrations(db as unknown as SqliteLike);
    const version = db.prepare('SELECT MAX(version) v FROM schema_version').get() as { v: number };
    expect(version.v).toBe(6);
  });

  it('v2 adds the display_order column with spawned_at as default', () => {
    runMigrations(db as unknown as SqliteLike);
    const cols = db.prepare(`PRAGMA table_info(instances)`).all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain('display_order');
  });

  it('v6 adds jira_* columns to tasks and the partial index', () => {
    runMigrations(db as unknown as SqliteLike);
    const cols = (
      db.prepare(`PRAGMA table_info(tasks)`).all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining([
        'jira_status',
        'jira_estimate_secs',
        'jira_component',
        'jira_synced_at',
      ]),
    );
    const idx = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_tasks_jira_status'`,
      )
      .get();
    expect(idx).toBeTruthy();
  });
});
