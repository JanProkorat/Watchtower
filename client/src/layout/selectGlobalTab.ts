import { DASHBOARD_TAB_ID, type TabId } from '@watchtower/shared/layout.js';

/**
 * Side-effecting dependencies the global tab bar needs to route a click.
 * Kept as plain callbacks so the routing decision is unit-testable without a
 * React tree.
 */
export interface GlobalTabSelectDeps {
  /** Switch the active module to Instances (the workspace lives there). */
  setActiveModule(module: 'instances'): void;
  /** Mount the tab's leaf in the layout tree and focus it. */
  ensureMounted(id: TabId): void;
  /** Set the active instance (null when selecting the Dashboard tab). */
  setActive(id: string | null): void;
  /** The focused instance id for a tab, or null if the tab has none. */
  focusedInstanceIdForTab(id: TabId): string | null;
}

/**
 * Handle a click on a global instance tab. The tab bar is rendered above every
 * module, so the first thing a click must do is bring the Instances module to
 * the front — that is what makes the bar a "go back to Instances from anywhere"
 * affordance. After that it mirrors the in-workspace selection behaviour:
 * mount + focus the tab, and activate its focused instance (or clear the active
 * instance for the Dashboard tab).
 */
export function selectGlobalTab(id: TabId, deps: GlobalTabSelectDeps): void {
  deps.setActiveModule('instances');
  deps.ensureMounted(id);
  if (id === DASHBOARD_TAB_ID) {
    deps.setActive(null);
    return;
  }
  const focused = deps.focusedInstanceIdForTab(id);
  if (focused) deps.setActive(focused);
}
