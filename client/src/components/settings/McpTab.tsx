import { EmptyTabState } from '../timetracker/EmptyTabState.js';

export function McpTab() {
  return (
    <EmptyTabState
      title="MCP servers"
      hint="Coming in Phase 28. Will list / add / edit / remove servers from the mcpServers key in ~/.claude/settings.json. Quick presets for common servers, best-effort connection test."
    />
  );
}
