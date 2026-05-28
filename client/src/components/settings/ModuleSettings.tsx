import { Box } from '@mui/material';
import type { SettingsView } from '../../util/settingsUrl.js';
import { GeneralTab } from './GeneralTab.js';
import { SettingsJsonTab } from './SettingsJsonTab.js';
import { HooksTab } from './HooksTab.js';
import { SkillsTab } from './SkillsTab.js';
import { AgentsTab } from './AgentsTab.js';
import { McpTab } from './McpTab.js';

interface Props {
  /** Lifted view state — sub-tab. Owned by `App`. */
  view: SettingsView;
}

/**
 * Root of the Settings module. The active sub-tab is driven entirely by the
 * side nav rail — the in-page tab strip that used to live here has moved to
 * the rail as a collapsible sub-section under Settings.
 */
export function ModuleSettings({ view }: Props) {
  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, pt: 1.5 }}>
      <Box sx={{ flex: 1, display: 'flex', overflow: 'auto', minHeight: 0 }}>
        {view.tab === 'general' && <GeneralTab />}
        {view.tab === 'json' && <SettingsJsonTab />}
        {view.tab === 'hooks' && <HooksTab />}
        {view.tab === 'skills' && <SkillsTab />}
        {view.tab === 'agents' && <AgentsTab />}
        {view.tab === 'mcp' && <McpTab />}
      </Box>
    </Box>
  );
}
