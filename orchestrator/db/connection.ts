import Database from 'better-sqlite3';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { runMigrations, type SqliteLike } from './migrations.js';
import { migrateTimetracker } from './migrateTimetracker.js';

export function appSupportDir(): string {
  const dir = path.join(homedir(), 'Library', 'Application Support', 'Watchtower');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function openDb(overridePath?: string): Database.Database {
  const dbPath = overridePath ?? path.join(appSupportDir(), 'data.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db as unknown as SqliteLike);

  // Best-effort absorb of legacy TimeTracker data. Idempotent: a marker row
  // makes re-runs a no-op once it's completed, and `no-source` is silent.
  // Failure here must not crash the orchestrator — the user can keep using
  // Watchtower without their TT history if the legacy DB is malformed.
  try {
    const result = migrateTimetracker(db as unknown as SqliteLike);
    if (result.status === 'completed') {
      console.log(
        `[orchestrator] absorbed TimeTracker data: ${result.counts.projects} projects, ` +
          `${result.counts.worklogs} worklogs · backup at ${result.backupPath}`,
      );
    }
  } catch (err) {
    console.error('[orchestrator] TimeTracker migration failed (continuing without absorb):', err);
  }

  return db;
}
