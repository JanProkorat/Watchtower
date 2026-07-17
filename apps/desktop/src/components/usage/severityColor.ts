/** Bar/accent color from ccusage status, falling back to % thresholds.
 * Returns an MUI palette path consumed directly in `sx`. */
export function severityColor(status: string | null, pct: number | null): string {
  if (status === 'exceeds') return 'error.main';
  if (status === 'warning') return 'warning.main';
  if (status === 'ok') return 'success.main';
  if (pct != null) {
    if (pct >= 90) return 'error.main';
    if (pct >= 75) return 'warning.main';
  }
  return 'primary.main';
}
