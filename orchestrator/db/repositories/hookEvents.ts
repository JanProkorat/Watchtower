import type { SqliteLike } from '../migrations.js';

export class HookEventsRepo {
  constructor(private db: SqliteLike) {}

  append(instanceId: string, eventName: string, payload: unknown, now: number): void {
    this.db
      .prepare(`INSERT INTO hook_events (instance_id, event_name, payload_json, received_at) VALUES (?, ?, ?, ?)`)
      .run(instanceId, eventName, JSON.stringify(payload), now);
  }

  listForInstance(instanceId: string): Array<{ eventName: string; payload: unknown; receivedAt: number }> {
    const rows = this.db
      .prepare(`SELECT event_name, payload_json, received_at FROM hook_events WHERE instance_id = ? ORDER BY received_at`)
      .all(instanceId) as Array<{ event_name: string; payload_json: string; received_at: number }>;
    return rows.map((r) => ({ eventName: r.event_name, payload: JSON.parse(r.payload_json), receivedAt: r.received_at }));
  }

  pruneOlderThan(cutoff: number): void {
    this.db.prepare(`DELETE FROM hook_events WHERE received_at < ?`).run(cutoff);
  }

  deleteForInstance(instanceId: string): void {
    this.db.prepare(`DELETE FROM hook_events WHERE instance_id = ?`).run(instanceId);
  }
}
