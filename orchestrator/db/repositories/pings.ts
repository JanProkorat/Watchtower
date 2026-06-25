import type { SqliteLike } from '../migrations.js';

export interface PingView {
  id: number;
  instanceId: string;
  kind: string;
  title: string;
  body: string;
  createdAt: number;
  answeredAt: number | null;
}

export class PingsRepo {
  constructor(private db: SqliteLike) {}

  create(p: { instanceId: string; kind: string; title: string; body: string; now: number }): number {
    const r = this.db.prepare(
      `INSERT INTO pings (instance_id, kind, title, body, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(p.instanceId, p.kind, p.title, p.body, p.now) as { lastInsertRowid: number | bigint };
    return Number(r.lastInsertRowid);
  }

  get(id: number): PingView | null {
    const row = this.db.prepare(`SELECT * FROM pings WHERE id = ?`).get(id) as
      | { id: number; instance_id: string; kind: string; title: string; body: string; created_at: number; answered_at: number | null }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      instanceId: row.instance_id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      createdAt: row.created_at,
      answeredAt: row.answered_at,
    };
  }

  markAnswered(id: number, now: number): void {
    this.db.prepare(`UPDATE pings SET answered_at = ? WHERE id = ?`).run(now, id);
  }

  markAnsweredByInstance(instanceId: string, now: number): void {
    this.db.prepare(
      `UPDATE pings SET answered_at = ? WHERE instance_id = ? AND answered_at IS NULL`,
    ).run(now, instanceId);
  }
}
