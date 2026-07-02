/**
 * Instances offered when filling a new pane: the tab group's instances minus
 * those already mounted in the current layout, preserving group order.
 */
export function availableInstancesForPicker(
  groupInstanceIds: string[],
  mountedInstanceIds: string[],
): string[] {
  const mounted = new Set(mountedInstanceIds);
  return groupInstanceIds.filter((id) => !mounted.has(id));
}
