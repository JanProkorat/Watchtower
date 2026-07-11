import type { AttentionThread } from '@watchtower/data-supabase';

export interface BellItem {
  instanceId: string;
  label: string;
  kind: string | null;
  reason: string;
  hasThread: boolean;
}

const REASON: Record<string, string> = {
  'waiting-permission': 'waiting for permission',
  'idle-notify': 'waiting for input',
  'waiting-input': 'waiting for input',
  'crashed': 'crashed',
};

/**
 * Merge escalation threads (Supabase-backed, cross-device) with the live
 * per-instance attention list (local orchestrator state) into a single
 * bell/notification feed.
 *
 * - De-duped by instanceId.
 * - A thread item wins over a live item for the same instanceId and is
 *   marked hasThread when unanswered.
 * - Threads that are answered/closed are excluded unless the instance is
 *   also present in the live list (in which case the live item stands).
 */
export function mergeAttention(
  threads: AttentionThread[],
  liveItems: { instanceId: string; label: string; reason: string }[],
): BellItem[] {
  const out = new Map<string, BellItem>();

  for (const li of liveItems) {
    out.set(li.instanceId, {
      instanceId: li.instanceId,
      label: li.label,
      kind: null,
      reason: li.reason,
      hasThread: false,
    });
  }

  for (const t of threads) {
    const isLive = out.has(t.instanceId);
    if (!t.unanswered && !isLive) continue; // answered/closed and not live: drop
    if (t.closed && !isLive) continue; // closed and not live: drop

    out.set(t.instanceId, {
      instanceId: t.instanceId,
      label: t.label,
      kind: t.kind,
      reason: t.kind ? (REASON[t.kind] ?? 'waiting for input') : (out.get(t.instanceId)?.reason ?? 'waiting for input'),
      hasThread: t.unanswered,
    });
  }

  return Array.from(out.values());
}
