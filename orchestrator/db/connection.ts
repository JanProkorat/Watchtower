import Database from 'better-sqlite3';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { runMigrations, type SqliteLike } from './migrations.js';

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
  return db;
}
