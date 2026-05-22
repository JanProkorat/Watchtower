import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CURRENT_VERSION = 1;

/** Minimal subset of any SQLite driver we use (better-sqlite3 in prod, node:sqlite in tests). */
export interface SqliteLike {
  exec(sql: string): unknown;
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
}

export function runMigrations(db: SqliteLike): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  const row = db.prepare('SELECT MAX(version) v FROM schema_version').get() as { v: number | null };
  const current = row.v ?? 0;
  if (current >= CURRENT_VERSION) return;
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = readFileSync(schemaPath, 'utf8');
  db.exec(sql);
  db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
    CURRENT_VERSION,
    Date.now(),
  );
}
