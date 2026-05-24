import { EmptyTabState } from '../timetracker/EmptyTabState.js';

export function SkillsTab() {
  return (
    <EmptyTabState
      title="Skills browser"
      hint="Coming in Phase 26. Will walk ~/.claude/skills/, project-scoped .claude/skills/, and plugin-provided skills. SKILL.md preview, enable/disable per project, search."
    />
  );
}
