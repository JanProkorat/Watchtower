import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAttentionInstances } from './useAttentionInstances.js';
import { reconcileAcked, visibleAttention } from './attentionAck.js';
import type { AttentionItem } from './attentionList.js';

export interface Attention {
  /** Un-acknowledged attention items — drives the bell badge count + hub list. */
  items: AttentionItem[];
  /** Ids the user has acknowledged (focused) — used to hide the tab ⚠️. */
  ackedIds: ReadonlySet<string>;
  /** Mark an instance seen: drops it from the bell and clears its tab ⚠️. */
  acknowledge: (instanceId: string) => void;
}

/**
 * Live "needs attention" list with a client-side acknowledged overlay.
 * See `attentionAck.ts` for the (testable) read semantics.
 */
export function useAttention(): Attention {
  const all = useAttentionInstances();
  const [ackedIds, setAckedIds] = useState<ReadonlySet<string>>(() => new Set());

  // Drop acks for instances no longer in an attention state, so a later
  // re-entry notifies again. Runs on every attention change; `reconcileAcked`
  // returns the same reference when nothing is pruned, so React bails (no loop).
  useEffect(() => {
    const attentionIds = new Set(all.map((i) => i.instanceId));
    setAckedIds((prev) => reconcileAcked(prev, attentionIds));
  }, [all]);

  const acknowledge = useCallback((instanceId: string) => {
    setAckedIds((prev) => (prev.has(instanceId) ? prev : new Set(prev).add(instanceId)));
  }, []);

  const items = useMemo(() => visibleAttention(all, ackedIds), [all, ackedIds]);
  return { items, ackedIds, acknowledge };
}
