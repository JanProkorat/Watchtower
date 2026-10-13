/** Tooltip for the "Show side panel" button; mentions unseen replay edits when there are any. */
export function sidePanelButtonTitle(unseen: number): string {
  if (unseen <= 0) return 'Show side panel';
  return `Show side panel · ${unseen} unseen ${unseen === 1 ? 'edit' : 'edits'}`;
}
