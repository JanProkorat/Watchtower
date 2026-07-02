/**
 * Move `deltaPercent` from the pane right of a divider into the pane left of it
 * (positive delta grows the left pane). Only the two panes flanking the divider
 * change; both are clamped to `min`.
 */
export function sizesAfterDrag(
  sizes: number[],
  dividerIndex: number,
  deltaPercent: number,
  min = 8,
): number[] {
  const next = [...sizes];
  const a = next[dividerIndex] ?? 0;
  const b = next[dividerIndex + 1] ?? 0;
  const pair = a + b;
  let newA = a + deltaPercent;
  newA = Math.max(min, Math.min(pair - min, newA));
  next[dividerIndex] = newA;
  next[dividerIndex + 1] = pair - newA;
  return next;
}
