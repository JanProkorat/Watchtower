import { Box, Tab, Tabs } from '@mui/material';
import { LIST_TABS, type ListTab } from '../../util/timetrackerUrl.js';
import { WorklogsList } from './WorklogsList.js';
import { TaskGridView } from './TaskGridView.js';
import { TimeOffTab } from './TimeOffTab.js';
import { ReportsTab } from './ReportsTab.js';
import { BoardTab } from './BoardTab.js';

interface Props {
  tab: Exclude<ListTab, 'projects'>;
  onTabChange(tab: ListTab): void;
  onActivateInstance(id: string): void;
  onOpenNewInstanceForCwd(cwd: string): void;
}

const TAB_LABELS: Record<ListTab, string> = {
  projects: 'Projects',
  worklogs: 'Worklogs',
  grid: 'Task grid',
  timeoff: 'Time off',
  reports: 'Reports',
  board: 'Board',
};

/**
 * Hosts the non-projects tabs (Worklogs, Task grid, Time off, Reports,
 * Board). The Projects tab gets its own master-detail page in
 * `ModuleTimeTracker` and never lands here.
 */
export function ListMode({ tab, onTabChange }: Props) {
  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}>
        <Tabs
          value={tab}
          onChange={(_, next: ListTab) => onTabChange(next)}
          variant="standard"
          sx={{ minHeight: 44 }}
        >
          {LIST_TABS.map((id) => (
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
        {tab === 'worklogs' && <WorklogsList />}
        {tab === 'grid' && <TaskGridView />}
        {tab === 'timeoff' && <TimeOffTab />}
        {tab === 'reports' && <ReportsTab />}
        {tab === 'board' && <BoardTab active={tab === 'board'} />}
      </Box>
    </Box>
  );
}
