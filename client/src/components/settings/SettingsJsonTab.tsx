import { EmptyTabState } from '../timetracker/EmptyTabState.js';

export function SettingsJsonTab() {
  return (
    <EmptyTabState
      title="settings.json editor"
      hint="Coming in Phase 24. Will show a structured form for known keys (permissions, autoApprove, telemetry, alwaysThinking, enabledPlugins, statusLine) plus a raw JSON editor for everything else. Backup-before-write, global vs project-scoped toggle."
    />
  );
}
