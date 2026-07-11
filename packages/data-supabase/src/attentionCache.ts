export interface AttentionMessage {
  syncId: string; instanceId: string; projectLabel: string | null;
  role: 'claude' | 'user'; kind: string | null; body: string | null;
  options: { number: number; label: string }[]; replyTo: string | null;
  injectedAt: string | null; closedAt: string | null; createdAt: string;
}
export interface AttentionThread {
  instanceId: string; label: string; kind: string | null;
  messages: AttentionMessage[]; unanswered: boolean; closed: boolean;
}
export const ATTENTION_CACHE_KEY = 'wt.attention.threads.v1';

export function mapAttentionRow(row: any): AttentionMessage {
  return {
    syncId: row.sync_id, instanceId: row.instance_id, projectLabel: row.project_label ?? null,
    role: row.role, kind: row.kind ?? null, body: row.body ?? null,
    options: Array.isArray(row.options) ? row.options : (row.options ? JSON.parse(row.options) : []),
    replyTo: row.reply_to ?? null, injectedAt: row.injected_at ?? null,
    closedAt: row.closed_at ?? null, createdAt: row.created_at,
  };
}

export function groupThreads(rows: AttentionMessage[]): AttentionThread[] {
  const byId = new Map<string, AttentionMessage[]>();
  for (const m of rows) { (byId.get(m.instanceId) ?? byId.set(m.instanceId, []).get(m.instanceId)!).push(m); }
  const threads: AttentionThread[] = [];
  for (const [instanceId, msgs] of byId) {
    msgs.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    const claudeMsgs = msgs.filter(m => m.role === 'claude');
    const lastClaude = claudeMsgs[claudeMsgs.length - 1];
    const answered = lastClaude ? msgs.some(m => m.role === 'user' && m.replyTo === lastClaude.syncId) : true;
    const closed = !!lastClaude?.closedAt;
    threads.push({
      instanceId, label: msgs[0]?.projectLabel ?? instanceId, kind: lastClaude?.kind ?? null,
      messages: msgs, unanswered: !answered && !closed, closed,
    });
  }
  return threads;
}
