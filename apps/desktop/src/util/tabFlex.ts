/**
 * Flex shorthand for a session tab so its width tracks the matching terminal
 * pane below it. `sizes` are the live panel percentages reported by the
 * resizable PanelGroup (via its `onLayout` callback); when they aren't known
 * yet (before the first layout) tabs fall back to equal widths.
 */
export function tabFlex(sizes: number[] | undefined, idx: number): string | number {
  const size = sizes?.[idx];
  if (size == null || !Number.isFinite(size) || size <= 0) return 1;
  return `${size} 1 0`;
}
