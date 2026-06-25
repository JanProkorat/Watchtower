import type { SqliteLike } from '../migrations.js';

export class PushDevicesRepo {
  constructor(private db: SqliteLike) {}

  register(token: string, platform: string, now: number): void {
    this.db.prepare(
      `INSERT INTO push_devices (apns_token, platform, registered_at) VALUES (?, ?, ?)
       ON CONFLICT(apns_token) DO UPDATE SET platform = excluded.platform, registered_at = excluded.registered_at`,
    ).run(token, platform, now);
  }

  remove(token: string): void {
    this.db.prepare(`DELETE FROM push_devices WHERE apns_token = ?`).run(token);
  }

  listTokens(): string[] {
    return (this.db.prepare(`SELECT apns_token FROM push_devices`).all() as Array<{ apns_token: string }>)
      .map((r) => r.apns_token);
  }
}
