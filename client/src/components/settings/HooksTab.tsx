import { EmptyTabState } from '../timetracker/EmptyTabState.js';

export function HooksTab() {
  return (
    <EmptyTabState
      title="Hooks viewer + editor"
      hint="Coming in Phase 25. Will list each hook event (SessionStart, UserPromptSubmit, Notification, Stop, SessionEnd, PreToolUse, PostToolUse) with its matchers + commands. Add / edit / remove forms, template library, and dry-run preview against a sample payload."
    />
  );
}
