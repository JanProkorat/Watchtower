import type { PrFindingPayload } from '@watchtower/shared/ipcContract.js';

/**
 * Render a single review finding into the comment body posted back to the
 * PR host (GitHub / Azure DevOps). Task 2 adds the host-specific posters
 * that call this; kept here so both providers share one format.
 */
export function formatFindingBody(f: PrFindingPayload): string {
  const head = `**[${f.severity}] ${f.category}** ${f.summary}`;
  return f.detail ? `${head}\n\n${f.detail}` : head;
}
