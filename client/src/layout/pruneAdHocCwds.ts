import type { InstanceView } from '../state/useInstances.js';

/**
 * Drop ad-hoc cwds whose last instance is gone.
 *
 * A project-less folder's tab is kept visible by `deriveTabs` for as long as
 * its cwd sits in `openAdHocCwds` (see deriveTabs.ts — "Always include cwd
 * tabs the user has opened ad-hoc, even empty"). That set is added to on spawn
 * but is not self-cleaning, so once the cwd has no backing instance rows the
 * tab would linger empty. This computes the pruned set.
 *
 * Returns the *same* Set reference when nothing changed so the caller can pass
 * it straight to a setState updater without forcing a re-render.
 *
 * NOTE: callers must guard against pruning mid-spawn — during a spawn the cwd
 * is added to the set before its instance row exists, so running this then
 * would wrongly drop the freshly-opened (still empty) tab.
 */
export function pruneAdHocCwds(
  openAdHocCwds: Set<string>,
  instances: InstanceView[],
): Set<string> {
  if (openAdHocCwds.size === 0) return openAdHocCwds;
  const liveCwds = new Set(instances.map((i) => i.cwd));
  let changed = false;
  const next = new Set<string>();
  for (const cwd of openAdHocCwds) {
    if (liveCwds.has(cwd)) next.add(cwd);
    else changed = true;
  }
  return changed ? next : openAdHocCwds;
}
