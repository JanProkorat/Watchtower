import type { AttentionItem } from './attentionList.js';

// Acknowledged attention — a client-side "read" overlay.
//
// The bell count and the tab ⚠️ are derived from *live* instance status, so
// there is no server-side "read" flag. Acknowledgement is local: focusing an
// instance (via the hub, a push tap, or its tab) marks it seen, so it drops
// out of the bell count and its tab ⚠️ clears — even though the instance is
// still in its attention state until you actually answer in the terminal.

/**
 * Keep an acknowledged id only while it is still in an attention state. When an
 * instance leaves attention (answered → running/finished) its ack is dropped,
 * so a later re-entry into an attention state notifies again ("read", not
 * "muted forever"). Returns `acked` unchanged (same reference) when nothing is
 * pruned, so the caller can bail out of a state update.
 */
export function reconcileAcked(
  acked: ReadonlySet<string>,
  attentionIds: ReadonlySet<string>,
): ReadonlySet<string> {
  let removed = false;
  const next = new Set<string>();
  for (const id of acked) {
    if (attentionIds.has(id)) next.add(id);
    else removed = true;
  }
  return removed ? next : acked;
}

/** Attention items the user has not yet acknowledged — the bell/hub contents. */
export function visibleAttention(
  all: readonly AttentionItem[],
  acked: ReadonlySet<string>,
): AttentionItem[] {
  return all.filter((i) => !acked.has(i.instanceId));
}
