// Cross-instance refresh bus for project data.
//
// `useProjects()` is mounted independently in more than one subtree — the
// instances TabStrip reads App.tsx's copy (to color tabs by project), while the
// TimeTracker module has its own copy behind the ProjectsPage. Each keeps its
// own useState + filter, so a project created or recolored in one subtree
// leaves the other stale: the classic symptom is a freshly created project's
// instance tab keeping its hash-fallback color (a random palette pick) instead
// of the chosen project color until the whole app reloads.
//
// Every successful mutation broadcasts here so all mounted hooks re-fetch. Kept
// as a tiny pure module (no React) so the fan-out is unit-testable on its own.

type Listener = () => void;

const listeners = new Set<Listener>();

/** Register a refresh callback; returns an unsubscribe function. */
export function subscribeProjects(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Notify every subscriber that project data changed. `except` lets the mutating
 * hook skip its own listener — it already awaits a local refresh before it
 * broadcasts, so re-refreshing itself would be redundant.
 */
export function broadcastProjectsChanged(except?: Listener): void {
  // Snapshot so a listener that (un)subscribes during iteration can't disturb it.
  for (const listener of [...listeners]) {
    if (listener !== except) listener();
  }
}
