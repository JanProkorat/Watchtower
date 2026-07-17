// Map a PR-watch inbox `latestEvent` kind (stored as `pr-<eventType>`, see
// orchestrator/index.ts notificationBody + the `pr-${ev.type}` log kind) to a
// short, human-readable notification message. The inbox item doesn't keep the
// event author, so the label is intentionally author-less.
const LABELS: Record<string, string> = {
  'pr-commented': 'New comment',
  'pr-approved': 'Approved',
  'pr-changes_requested': 'Changes requested',
  'pr-review_requested': 'Review requested',
  'pr-reviewed': 'Reviewed',
};

export function prEventLabel(latestEvent: string): string {
  if (!latestEvent) return 'Update';
  const known = LABELS[latestEvent];
  if (known) return known;
  // Unknown kind: strip the `pr-` prefix, turn separators into spaces, sentence-case.
  const words = latestEvent.replace(/^pr-/, '').replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Update';
}
