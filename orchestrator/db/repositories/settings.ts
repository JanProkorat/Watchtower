import type { SqliteLike } from '../migrations.js';

export class SettingsRepo {
  constructor(private db: SqliteLike) {}

  getString(key: string, def: string): string {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
    return row?.value ?? def;
  }

  getNumber(key: string, def: number): number {
    const s = this.getString(key, String(def));
    const n = Number(s);
    return Number.isFinite(n) ? n : def;
  }

  set(key: string, value: string): void {
    this.db
      .prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(key, value);
  }
}
