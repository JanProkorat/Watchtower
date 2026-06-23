import type { SqliteLike } from '../db/migrations.js';
import { SettingsRepo } from '../db/repositories/settings.js';

const EPOCH = '1970-01-01T00:00:00.000Z';

function key(dir: 'push' | 'pull', table: string): string {
  return `sync.cursor.${dir}.${table}`;
}

export function getCursor(db: SqliteLike, dir: 'push' | 'pull', table: string): string {
  const v = new SettingsRepo(db).getString(key(dir, table), '');
  return v && v.trim() ? v : EPOCH;
}

export function setCursor(db: SqliteLike, dir: 'push' | 'pull', table: string, iso: string): void {
  new SettingsRepo(db).set(key(dir, table), iso);
}
