import type { PullRequestPayload } from '@watchtower/shared/ipcContract.js';

/** Stable identity for a PR across cycles. */
export function prKey(pr: { host: string; repoKey: string; number: number }): string {
  return `${pr.host}:${pr.repoKey}:${pr.number}`;
}

/**
 * Diff the prior open set against the freshly-fetched one.
 *  - `candidates`: PRs that were open last cycle, whose repo fetched OK this
 *    cycle, and are no longer open — i.e. merged or closed (to be classified).
 *  - `nextCache`: the new open set, plus prev PRs whose repo did NOT fetch this
 *    cycle (retain them — a transient repo failure must not clear the list or
 *    look like a merge).
 */
export function detectListChange(
  prev: PullRequestPayload[],
  open: PullRequestPayload[],
  succeededRepoKeys: ReadonlySet<string>,
): { nextCache: PullRequestPayload[]; candidates: PullRequestPayload[] } {
  const openKeys = new Set(open.map(prKey));
  const candidates = prev.filter(
    (p) => succeededRepoKeys.has(p.repoKey) && !openKeys.has(prKey(p)),
  );
  const retained = prev.filter(
    (p) => !succeededRepoKeys.has(p.repoKey) && !openKeys.has(prKey(p)),
  );
  return { nextCache: [...open, ...retained], candidates };
}
