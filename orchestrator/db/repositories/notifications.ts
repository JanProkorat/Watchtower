import type { SqliteLike } from '../migrations.js';

export class NotificationsRepo {
  constructor(private db: SqliteLike) {}

  log(instanceId: string, kind: string, body: string, now: number): void {
    this.db
      .prepare(`INSERT INTO notifications (instance_id, kind, fired_at, body) VALUES (?, ?, ?, ?)`)
      .run(instanceId, kind, now, body);
  }

  dismiss(id: number, now: number): void {
    this.db.prepare(`UPDATE notifications SET dismissed_at = ? WHERE id = ?`).run(now, id);
  }
}
