import { parseEscalation } from './escalationMessage.js';

export interface AttentionRelayDeps {
  pg: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> } | null;
  getSnapshot(instanceId: string): Promise<string>;
  deliverReply(instanceId: string, text: string): boolean;
  resolveLabel(cwd: string): string;
  newId(): string;
  now(): string;
}
export interface AttentionRelay {
  writeClaudeMessage(instanceId: string, cwd: string, kind: string): Promise<void>;
  pollOnce(): Promise<number>;
  hasOutstanding(): Promise<boolean>;
  start(): void; stop(): void;
  closeThread(instanceId: string): Promise<void>;
  pruneClosedThreads(olderThanDays?: number): Promise<number>;
}

const FAST_MS = 3_000;
const SLOW_MS = 30_000;
const DEFAULT_PRUNE_DAYS = 14;

export function createAttentionRelay(deps: AttentionRelayDeps): AttentionRelay {
  let timer: NodeJS.Timeout | null = null;

  async function writeClaudeMessage(instanceId: string, cwd: string, kind: string) {
    if (!deps.pg) return;
    const snap = await deps.getSnapshot(instanceId);
    const { options } = parseEscalation(snap);
    await deps.pg.query(
      `INSERT INTO attention_messages
         (sync_id, instance_id, project_label, role, kind, body, options, created_at)
       VALUES ($1,$2,$3,'claude',$4,$5,$6::jsonb,$7)
       ON CONFLICT (sync_id) DO NOTHING`,
      [deps.newId(), instanceId, deps.resolveLabel(cwd), kind, snap, JSON.stringify(options), deps.now()],
    );
  }

  async function pollOnce(): Promise<number> {
    if (!deps.pg) return 0;
    const { rows } = await deps.pg.query(
      `SELECT sync_id, instance_id, body FROM attention_messages
       WHERE role = 'user' AND injected_at IS NULL ORDER BY created_at ASC`,
    );
    let injected = 0;
    for (const r of rows) {
      deps.deliverReply(r.instance_id, r.body ?? ''); // returns false if instance gone — still stamp
      await deps.pg.query(
        `UPDATE attention_messages SET injected_at = $1 WHERE sync_id = $2`,
        [deps.now(), r.sync_id],
      );
      injected++;
    }
    return injected;
  }

  async function hasOutstanding(): Promise<boolean> {
    if (!deps.pg) return false;
    const { rows } = await deps.pg.query(
      `SELECT 1 FROM attention_messages c
       WHERE c.role = 'claude' AND c.closed_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM attention_messages u
                         WHERE u.role='user' AND u.reply_to = c.sync_id)
       LIMIT 1`,
    );
    return rows.length > 0;
  }

  async function closeThread(instanceId: string) {
    if (!deps.pg) return;
    await deps.pg.query(
      `UPDATE attention_messages SET closed_at = $1 WHERE instance_id = $2 AND closed_at IS NULL`,
      [deps.now(), instanceId],
    );
  }

  // Retention: drop closed threads once they're old enough that nobody will
  // scroll back to them. Cutoff is derived from deps.now() (not Date.now())
  // so it stays testable/deterministic with the injected clock, matching the
  // rest of this module's convention.
  async function pruneClosedThreads(olderThanDays: number = DEFAULT_PRUNE_DAYS): Promise<number> {
    if (!deps.pg) return 0;
    const cutoffMs = new Date(deps.now()).getTime() - olderThanDays * 24 * 60 * 60 * 1000;
    const cutoff = new Date(cutoffMs).toISOString();
    const { rows } = await deps.pg.query(
      `DELETE FROM attention_messages WHERE closed_at IS NOT NULL AND closed_at < $1 RETURNING sync_id`,
      [cutoff],
    );
    return rows.length;
  }

  function schedule() {
    if (!deps.pg) return;
    const tick = async () => {
      let delay = SLOW_MS;
      try { await pollOnce(); delay = (await hasOutstanding()) ? FAST_MS : SLOW_MS; }
      catch { /* offline-tolerant */ }
      timer = setTimeout(tick, delay);
      if (timer.unref) timer.unref();
    };
    timer = setTimeout(tick, FAST_MS);
    if (timer.unref) timer.unref();
  }

  return {
    writeClaudeMessage, pollOnce, hasOutstanding, closeThread, pruneClosedThreads,
    start: () => { if (!timer) schedule(); },
    stop: () => { if (timer) { clearTimeout(timer); timer = null; } },
  };
}
