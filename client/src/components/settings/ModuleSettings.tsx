import { Box, Tab, Tabs } from '@mui/material';
import { useSettingsView } from '../../state/useSettingsView.js';
import { SETTINGS_TABS, type SettingsTab } from '../../util/settingsUrl.js';
import { GeneralTab } from './GeneralTab.js';
import { SettingsJsonTab } from './SettingsJsonTab.js';
import { HooksTab } from './HooksTab.js';
import { SkillsTab } from './SkillsTab.js';
import { AgentsTab } from './AgentsTab.js';
import { McpTab } from './McpTab.js';

interface Props {
  /** True while the Settings rail icon is the active module. */
  active: boolean;
}

const TAB_LABELS: Record<SettingsTab, string> = {
  general: 'General',
  json: 'settings.json',
  hooks: 'Hooks',
  skills: 'Skills',
  agents: 'Agents',
  mcp: 'MCP',
};

/**
 * Root of the Settings module. Replaces the narrow Watchtower-specific
 * SettingsPanel with a tabbed UI that hosts the full ~/.claude/ config
 * surface. Phase 23 only ships the shell — non-General tabs are
 * placeholders for the per-tab phases that follow.
 */
export function ModuleSettings({ active }: Props) {
  const { view, setTab } = useSettingsView(active);

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}>
        <Tabs
          value={view.tab}
          onChange={(_, next: SettingsTab) => setTab(next)}
          variant="standard"
          sx={{ minHeight: 44 }}
        >
          {SETTINGS_TABS.map((id) => (
            <Tab
              key={id}
              value={id}
              label={TAB_LABELS[id]}
              sx={{ textTransform: 'none', fontSize: 13, minHeight: 44, fontWeight: 500 }}
            />
          ))}
        </Tabs>
      </Box>

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
