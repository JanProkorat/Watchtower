import { EmptyTabState } from '../timetracker/EmptyTabState.js';

export function AgentsTab() {
  return (
    <EmptyTabState
      title="Agents browser"
      hint="Coming in Phase 27. Will walk ~/.claude/agents/ + plugin-provided agents. Frontmatter (description, tools, model) as a structured table, prompt body as markdown. View-only first cut."
    />
  );
}
