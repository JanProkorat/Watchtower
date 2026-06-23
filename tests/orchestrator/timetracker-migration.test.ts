import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import {
  migrateTimetracker,
  type MigrationStatus,
} from '../../orchestrator/db/migrateTimetracker.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

interface NodeSqliteDb {
  exec(sql: string): unknown;
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
}

function openTarget(p: string): NodeSqliteDb {
  const db = new DatabaseSync(p);
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db as unknown as SqliteLike);
  return db as unknown as NodeSqliteDb;
}

/**
 * Build a synthetic TimeTracker SQLite file at `path`, seeded with a handful
 * of rows per table. Mirrors TT's schema.sql + post-schema migrations.
 */
function seedTimetrackerSource(p: string): void {
  const db = new DatabaseSync(p);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      base_url TEXT,
      color TEXT NOT NULL DEFAULT '#1976d2',
      archived INTEGER NOT NULL DEFAULT 0,
      is_billable INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL DEFAULT 'work',
      rate_type TEXT NOT NULL DEFAULT 'hourly',
      rate_amount REAL,
      currency TEXT NOT NULL DEFAULT 'USD',
      hours_per_day REAL NOT NULL DEFAULT 8,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE epics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      epic_id INTEGER NOT NULL,
      number TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      estimated_minutes INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE worklogs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      description TEXT,
      work_date TEXT NOT NULL,
      minutes INTEGER NOT NULL,
      reported_minutes INTEGER,
      source TEXT,
      external_id TEXT,
      jira_uploaded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE project_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      effective_from TEXT NOT NULL,
      rate_type TEXT NOT NULL,
      rate_amount REAL NOT NULL,
      currency TEXT NOT NULL,
      hours_per_day REAL NOT NULL DEFAULT 8,
      end_date TEXT,
      md_limit REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE days_off (
      date TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'vacation',
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.prepare(`INSERT INTO projects (id, name, color, is_billable, kind, is_default) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(1, 'PPS Capacity Planning', '#f0a868', 1, 'work', 1);
  db.prepare(`INSERT INTO projects (id, name, color, is_billable, kind) VALUES (?, ?, ?, ?, ?)`)
    .run(2, 'Watchtower', '#7aa7ff', 0, 'work');

  db.prepare(`INSERT INTO epics (id, project_id, name) VALUES (?, ?, ?)`).run(1, 1, 'Phase 6');
  db.prepare(`INSERT INTO epics (id, project_id, name) VALUES (?, ?, ?)`).run(2, 2, 'MVP');

  db.prepare(`INSERT INTO tasks (id, epic_id, number, title, status, estimated_minutes) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(1, 1, 'FIE1933-18887', 'RFP handler', 'in_progress', 360);
  db.prepare(`INSERT INTO tasks (id, epic_id, number, title) VALUES (?, ?, ?, ?)`)
    .run(2, 2, 'WT-T37', 'Build & ship');

  db.prepare(`INSERT INTO worklogs (id, task_id, description, work_date, minutes, source) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(1, 1, 'Endpoint dotaz', '2026-05-04', 120, 'manual');
  db.prepare(`INSERT INTO worklogs (id, task_id, work_date, minutes, source, external_id) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(2, 2, '2026-05-22', 75, 'watchtower-auto', 'sha-abc');

  db.prepare(`INSERT INTO project_rates (id, project_id, effective_from, rate_type, rate_amount, currency, hours_per_day) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(1, 1, '2026-01-01', 'hourly', 1600, 'CZK', 8);

  db.prepare(`INSERT INTO days_off (date, kind, note) VALUES (?, ?, ?)`).run('2026-05-15', 'sick', 'Flu');

  db.close();
}

function tableCount(db: NodeSqliteDb, name: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ${name}`).get() as { c: number };
  return row.c;
}

describe('migrateTimetracker', () => {
  let dir: string;
  let targetPath: string;
  let sourcePath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'wt-tt-'));
    targetPath = path.join(dir, 'data.db');
    sourcePath = path.join(dir, 'timetracker.db');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns no-source when the legacy DB is absent', () => {
    const target = openTarget(targetPath);
    const result = migrateTimetracker(target as unknown as SqliteLike, { sourcePath });
    expect(result.status).toBe('no-source');
    target.close();
  });

  it('copies all rows in dependency order and renames the source', () => {
    seedTimetrackerSource(sourcePath);
    const target = openTarget(targetPath);

    const fixedNow = () => new Date('2026-05-24T12:34:56Z');
    const openSource = (p: string) => {
      const db = new DatabaseSync(p);
      return db as unknown as SqliteLike & { close(): void };
    };

    const result = migrateTimetracker(target as unknown as SqliteLike, {
      sourcePath,
      openSource,
      now: fixedNow,
    });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') return;

    expect(result.counts).toEqual({
      projects: 2,
      project_rates: 1,
      epics: 2,
      tasks: 2,
      worklogs: 2,
      days_off: 1,
    });

    // Destination row counts match
    expect(tableCount(target, 'projects')).toBe(2);
    expect(tableCount(target, 'epics')).toBe(2);
    expect(tableCount(target, 'tasks')).toBe(2);
    expect(tableCount(target, 'worklogs')).toBe(2);
    expect(tableCount(target, 'contracts')).toBe(1);
    expect(tableCount(target, 'days_off')).toBe(1);

    // Primary keys preserved (FK integrity check)
    const proj = target.prepare(`SELECT id, name, is_default FROM projects ORDER BY id`).all() as Array<{ id: number; name: string; is_default: number }>;
    expect(proj).toEqual([
      { id: 1, name: 'PPS Capacity Planning', is_default: 1 },
      { id: 2, name: 'Watchtower', is_default: 0 },
    ]);

    // Source renamed, not deleted
    expect(existsSync(sourcePath)).toBe(false);
    expect(existsSync(result.backupPath)).toBe(true);
    expect(result.backupPath).toMatch(/\.migrated-20260524-\d{6}\.bak$/);

    // Marker row written
    const marker = target.prepare(`SELECT value FROM settings WHERE key = 'timetracker_migration_status'`).get() as { value: string } | undefined;
    expect(marker).toBeDefined();
    const parsed = JSON.parse(marker!.value) as { status: string; counts: { worklogs: number } };
    expect(parsed.status).toBe('completed');
    expect(parsed.counts.worklogs).toBe(2);

    target.close();
  });

  it('is idempotent — second call returns already-migrated even when source exists', () => {
    seedTimetrackerSource(sourcePath);
    const target = openTarget(targetPath);
    const openSource = (p: string) => new DatabaseSync(p) as unknown as SqliteLike & { close(): void };

    const first = migrateTimetracker(target as unknown as SqliteLike, { sourcePath, openSource });
    expect(first.status).toBe('completed');

    // Recreate the source file (simulating a user dropping a backup back into place)
    seedTimetrackerSource(sourcePath);
    const second = migrateTimetracker(target as unknown as SqliteLike, { sourcePath, openSource });
    expect(second.status).toBe('already-migrated');

    // No duplicates introduced
    expect(tableCount(target, 'projects')).toBe(2);
    expect(tableCount(target, 'worklogs')).toBe(2);
    target.close();
  });

  it('rolls back on partial failure — no rows leak through', () => {
    seedTimetrackerSource(sourcePath);
    const target = openTarget(targetPath);
    const openSource = (p: string) => new DatabaseSync(p) as unknown as SqliteLike & { close(): void };

    // Sabotage: pre-insert a worklog whose row id will collide with the
    // first imported worklog (id = 1). The transaction must roll back the
    // *entire* batch — no projects/epics/etc. should survive.
    target.prepare(`INSERT INTO projects (id, name) VALUES (1, 'pre-existing')`).run();
    target.prepare(`INSERT INTO epics (id, project_id, name) VALUES (1, 1, 'pre-existing')`).run();
    target.prepare(`INSERT INTO tasks (id, epic_id, number, title) VALUES (1, 1, 'X-1', 'pre-existing')`).run();
    target.prepare(`INSERT INTO worklogs (id, task_id, work_date, minutes) VALUES (1, 1, '2026-01-01', 30)`).run();

    expect(() =>
      migrateTimetracker(target as unknown as SqliteLike, { sourcePath, openSource }),
    ).toThrow();

    // Pre-existing rows are intact; nothing from the source landed
    expect(tableCount(target, 'projects')).toBe(1);
    const proj = target.prepare(`SELECT name FROM projects WHERE id = 1`).get() as { name: string };
    expect(proj.name).toBe('pre-existing');

    // Source file still in place — rollback path doesn't rename
    expect(existsSync(sourcePath)).toBe(true);
    target.close();
  });

  it('handles an empty source DB gracefully', () => {
    // Source file exists but has no rows in any table
    const empty = new DatabaseSync(sourcePath);
    empty.exec(`
      CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, base_url TEXT, color TEXT, archived INTEGER, is_billable INTEGER, kind TEXT, rate_type TEXT, rate_amount REAL, currency TEXT, hours_per_day REAL, is_default INTEGER, created_at TEXT);
      CREATE TABLE epics (id INTEGER PRIMARY KEY, project_id INTEGER, name TEXT, description TEXT, created_at TEXT);
      CREATE TABLE tasks (id INTEGER PRIMARY KEY, epic_id INTEGER, number TEXT, title TEXT, status TEXT, estimated_minutes INTEGER, created_at TEXT);
      CREATE TABLE worklogs (id INTEGER PRIMARY KEY, task_id INTEGER, description TEXT, work_date TEXT, minutes INTEGER, reported_minutes INTEGER, source TEXT, external_id TEXT, jira_uploaded INTEGER, created_at TEXT);
      CREATE TABLE project_rates (id INTEGER PRIMARY KEY, project_id INTEGER, effective_from TEXT, rate_type TEXT, rate_amount REAL, currency TEXT, hours_per_day REAL, end_date TEXT, md_limit REAL, created_at TEXT);
      CREATE TABLE days_off (date TEXT PRIMARY KEY, kind TEXT, note TEXT, created_at TEXT);
    `);
    empty.close();

    const target = openTarget(targetPath);
    const openSource = (p: string) => new DatabaseSync(p) as unknown as SqliteLike & { close(): void };

    const result = migrateTimetracker(target as unknown as SqliteLike, { sourcePath, openSource });
    expect(result.status).toBe('completed');
    if (result.status === 'completed') {
      expect(result.counts).toEqual({
        projects: 0, project_rates: 0, epics: 0, tasks: 0, worklogs: 0, days_off: 0,
      });
    }
    expect(existsSync(sourcePath)).toBe(false);
    target.close();
  });
});

describe('migrations · v3 adds TimeTracker tables', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
  });

  it('creates projects, epics, tasks, worklogs, contracts, days_off', () => {
    const db = new DatabaseSync(dbPath);
    runMigrations(db as unknown as SqliteLike);
    const rows = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as Array<{ name: string }>;
    const names = rows.map((r) => r.name);
    expect(names).toContain('projects');
    expect(names).toContain('epics');
    expect(names).toContain('tasks');
    expect(names).toContain('worklogs');
    expect(names).toContain('contracts');
    expect(names).toContain('days_off');
    db.close();
  });

  it('creates the partial unique indexes on projects.is_default and worklogs.(source, external_id)', () => {
    const db = new DatabaseSync(dbPath);
    runMigrations(db as unknown as SqliteLike);

    // Two projects with is_default = 1 should violate the partial unique index
    db.prepare(`INSERT INTO projects (id, name, is_default) VALUES (1, 'A', 1)`).run();
    expect(() =>
      db.prepare(`INSERT INTO projects (id, name, is_default) VALUES (2, 'B', 1)`).run(),
    ).toThrow();

    // Two worklogs with the same (source, external_id) should also violate
    db.prepare(`INSERT INTO epics (id, project_id, name) VALUES (1, 1, 'E')`).run();
    db.prepare(`INSERT INTO tasks (id, epic_id, number, title) VALUES (1, 1, 'X', 'T')`).run();
    db.prepare(`INSERT INTO worklogs (id, task_id, work_date, minutes, source, external_id) VALUES (1, 1, '2026-01-01', 30, 'jira', 'sha-1')`).run();
    expect(() =>
      db.prepare(`INSERT INTO worklogs (id, task_id, work_date, minutes, source, external_id) VALUES (2, 1, '2026-01-02', 45, 'jira', 'sha-1')`).run(),
    ).toThrow();

    db.close();
  });

  it('reports the latest schema version after running migrations', () => {
    const db = new DatabaseSync(dbPath);
    runMigrations(db as unknown as SqliteLike);
    const row = db.prepare(`SELECT MAX(version) v FROM schema_version`).get() as { v: number };
    // v3 adds the TT tables; subsequent migrations (v4+) extend them.
    expect(row.v).toBeGreaterThanOrEqual(3);
    db.close();
  });
});

// Quick anchor so the seed helper isn't flagged as unused if a test ever skips
describe('seedTimetrackerSource helper', () => {
  it('produces a readable source DB', () => {
    const p = path.join(mkdtempSync(path.join(tmpdir(), 'wt-tt-')), 'src.db');
    seedTimetrackerSource(p);
    const db = new DatabaseSync(p);
    const row = db.prepare(`SELECT COUNT(*) c FROM projects`).get() as { c: number };
    expect(row.c).toBe(2);
    db.close();
    writeFileSync(p + '.touched', '');
  });
});

// Surface MigrationStatus shape — purely a compile-time check.
const _statusTypeCheck: MigrationStatus[] = [
  { status: 'no-source' },
  { status: 'already-migrated', at: 'x' },
  { status: 'completed', sourcePath: 'a', backupPath: 'b', counts: { projects: 0, project_rates: 0, epics: 0, tasks: 0, worklogs: 0, days_off: 0 } },
];
void _statusTypeCheck;
