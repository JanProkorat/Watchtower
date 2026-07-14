import type { SqliteLike } from '../migrations.js';

const DEFAULT_BUNDLE_ID = 'cz.greencode.watchtower.ipad';

export class PushDevicesRepo {
  constructor(private db: SqliteLike) {}

  register(token: string, platform: string, now: number, bundleId: string = DEFAULT_BUNDLE_ID): void {
    this.db.prepare(
      `INSERT INTO push_devices (apns_token, platform, registered_at, bundle_id) VALUES (?, ?, ?, ?)
       ON CONFLICT(apns_token) DO UPDATE SET platform = excluded.platform, registered_at = excluded.registered_at, bundle_id = excluded.bundle_id`,
    ).run(token, platform, now, bundleId);
  }

  remove(token: string): void {
    this.db.prepare(`DELETE FROM push_devices WHERE apns_token = ?`).run(token);
  }

  listTokens(): { token: string; bundleId: string }[] {
    return this.db
      .prepare(`SELECT apns_token AS token, bundle_id AS bundleId FROM push_devices`)
      .all() as { token: string; bundleId: string }[];
  }
}
