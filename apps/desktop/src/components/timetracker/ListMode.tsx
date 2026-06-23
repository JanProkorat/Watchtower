import { Box } from '@mui/material';
import type { ListTab } from '../../util/timetrackerUrl.js';
import { WorklogsList } from './WorklogsList.js';
import { TaskGridView } from './TaskGridView.js';
import { TimeOffTab } from './TimeOffTab.js';
import { ReportsTab } from './ReportsTab.js';
import { BoardTab } from './BoardTab.js';

interface Props {
  tab: Exclude<ListTab, 'projects'>;
  onActivateInstance(id: string): void;
  onOpenNewInstanceForCwd(cwd: string): void;
}

/**
 * Hosts the non-projects Billing sub-tabs (Worklogs, Task grid, Time off,
 * Reports, Board). The sub-tab switcher lives in the rail; this component
 * just routes the active tab to the right content. Projects has its own
 * master-detail page in `ModuleTimeTracker` and never lands here.
 */
export function ListMode({ tab }: Props) {
  return (
    <Box sx={{ flex: 1, display: 'flex', overflow: 'auto', minHeight: 0 }}>
      {tab === 'worklogs' && <WorklogsList />}
      {tab === 'grid' && <TaskGridView />}
      {tab === 'timeoff' && <TimeOffTab />}
      {tab === 'reports' && <ReportsTab />}
      {tab === 'board' && <BoardTab active={tab === 'board'} />}
    </Box>
  );
}
