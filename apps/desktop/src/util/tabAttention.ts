// Statuses that mean a session is blocked on the user: a permission decision,
// a finished turn awaiting input, or a crash. These raise the ⚠️ marker on the
// owning project tab. `idle-notify` is deliberately excluded — it is passive
// (session went idle) and keeps the tab's accent dot.
export const ACTION_NEEDED_STATUSES: ReadonlySet<string> = new Set([
  'waiting-permission',
  'waiting-input',
  'crashed',
]);

interface TabMembers {
  id: string;
  columnOrder: string[];
  hiddenInstanceIds: string[];
}

/**
 * Returns the ids of tabs that have at least one session (visible or hidden)
 * in an action-needed state, given a map of instanceId → status.
 */
export function tabsNeedingAttention(
  tabs: ReadonlyArray<TabMembers>,
  statusById: ReadonlyMap<string, string>,
): Set<string> {
  const out = new Set<string>();
  for (const t of tabs) {
    const members = [...t.columnOrder, ...t.hiddenInstanceIds];
    if (members.some((id) => ACTION_NEEDED_STATUSES.has(statusById.get(id) ?? ''))) {
      out.add(t.id);
    }
  }
  return out;
}
