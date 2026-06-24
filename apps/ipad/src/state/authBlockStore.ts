export function applyAuthBlock(prev: Set<string>, e: { instanceId: string; blocked: boolean }): Set<string> {
  if (e.blocked === prev.has(e.instanceId)) return prev; // no change → stable identity
  const next = new Set(prev);
  if (e.blocked) next.add(e.instanceId); else next.delete(e.instanceId);
  return next;
}
